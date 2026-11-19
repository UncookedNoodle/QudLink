using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Text;
using System.Threading;
using ConsoleLib.Console;
using Newtonsoft.Json;
using Qud.API;
using XRL;
using XRL.World;
using XRL.World.Parts;
using XRL.UI;
using Kobold;
using XRL.World.Capabilities;

namespace QudLink
{
    // Local HTTP API for a second-screen companion app.
    //   GET /state                     -> full snapshot
    //   GET /actions?id=N              -> inventory actions for item N
    //   GET /do?cmd=CmdX               -> push a game command (abilities, wait, menus...)
    //   GET /do?id=N&action=Command    -> run an inventory action on item N
    [HasModSensitiveStaticCache]
    public static class Server
    {
        public const int Port = 8765;
        static HttpListener listener;
        static readonly object idLock = new object();
        static readonly Dictionary<int, GameObject> idToObj = new Dictionary<int, GameObject>();
        static readonly Dictionary<GameObject, int> objToId = new Dictionary<GameObject, int>();
        static int nextId = 1;
        static string lastState = "{\"player\":null}";

        [ModSensitiveCacheInit]
        public static void Start()
        {
            if (listener != null) return;
            try { uiDir = System.IO.Path.Combine(ModManager.GetMod()?.Path ?? "", "ui"); } catch { }
            try
            {
                listener = new HttpListener();
                // Loopback only: the companion app runs on the same device. Never expose game control to the LAN.
                listener.Prefixes.Add("http://127.0.0.1:" + Port + "/");
                listener.Prefixes.Add("http://localhost:" + Port + "/");
                listener.Start();
                new Thread(Loop) { IsBackground = true, Name = "QudLink" }.Start();
                // Keep the game ticking when the companion app/browser has focus.
                try { UnityEngine.Application.runInBackground = true; } catch { }
                GameManager.Instance?.uiQueue.queueTask(() => UnityEngine.Application.runInBackground = true);
                UnityEngine.Debug.Log("QudLink: listening on " + Port);
            }
            catch (Exception e) { UnityEngine.Debug.LogError("QudLink start failed: " + e); listener = null; }
        }

        static void Loop()
        {
            while (listener != null && listener.IsListening)
            {
                HttpListenerContext ctx;
                try { ctx = listener.GetContext(); }
                catch { continue; }
                ThreadPool.QueueUserWorkItem(_ => Handle(ctx));
            }
        }

        static string uiDir;
        static readonly Dictionary<string, string> UiFiles = new Dictionary<string, string> {
            { "/", "index.html" }, { "/index.html", "index.html" }, { "/app.js", "app.js" },
            { "/qudtext.js", "qudtext.js" }, { "/shaders.js", "shaders.js" }, { "/demo.js", "demo.js" } };

        // Browser UI: http://127.0.0.1:8765/ serves the same page the Android app bundles.
        static bool ServeUi(HttpListenerContext ctx, string path)
        {
            if (!UiFiles.TryGetValue(path, out var name) || uiDir == null) return false;
            var f = System.IO.Path.Combine(uiDir, name);
            if (!System.IO.File.Exists(f)) return false;
            var b = System.IO.File.ReadAllBytes(f);
            ctx.Response.ContentType = name.EndsWith(".html") ? "text/html; charset=utf-8" : "text/javascript; charset=utf-8";
            ctx.Response.AddHeader("Cache-Control", "no-cache");
            ctx.Response.OutputStream.Write(b, 0, b.Length);
            ctx.Response.Close();
            return true;
        }

        static void Handle(HttpListenerContext ctx)
        {
            string body;
            try
            {
                var q = ctx.Request.QueryString;
                string path = ctx.Request.Url.AbsolutePath;
                if (ctx.Request.HttpMethod == "OPTIONS")
                {
                    // Only the companion app (loaded from a local file => Origin "null") may send X-QudLink.
                    if (ctx.Request.Headers["Origin"] == "null")
                    {
                        ctx.Response.AddHeader("Access-Control-Allow-Origin", "null");
                        ctx.Response.AddHeader("Access-Control-Allow-Headers", "X-QudLink");
                        ctx.Response.AddHeader("Access-Control-Allow-Methods", "GET");
                    }
                    ctx.Response.StatusCode = 204; ctx.Response.Close(); return;
                }
                if (ServeUi(ctx, path)) return;
                // Commands need a custom header. Browsers can't add one cross-origin without a CORS
                // preflight (which we never approve), so random web pages can't drive the game.
                if ((path == "/do" || path == "/actions" || path == "/travel" || path == "/look" || path == "/target" || path == "/describe") && ctx.Request.Headers["X-QudLink"] != "1")
                {
                    ctx.Response.StatusCode = 403; ctx.Response.Close(); return;
                }
                switch (ctx.Request.Url.AbsolutePath)
                {
                    case "/state": body = OnGame(BuildState, 150) ?? Direct(BuildState) ?? lastState; break;
                    case "/actions": { int aid = ParseId(q["id"]); body = OnGame(() => BuildActions(aid), 600, wake: true) ?? Direct(() => BuildActions(aid)) ?? "{\"error\":\"busy\"}"; } break;
                    case "/tile": ServeTile(ctx, q["p"], q["f"], q["d"]); return;
                    case "/map": body = OnGame(BuildMap, 300, wake: false) ?? Direct(BuildMap) ?? "{\"error\":\"busy\"}"; break;
                    case "/describe": { int did = ParseId(q["id"]); body = OnGame(() => Describe(did), 800, wake: true) ?? Direct(() => Describe(did)) ?? "{\"error\":\"busy\"}"; } break;
                    case "/travel": body = Travel(ParseId(q["x"]), ParseId(q["y"])); break;
                    case "/look": Keyboard.PushMouseEvent("AdventureMouseLook", ParseId(q["x"]), ParseId(q["y"])); body = "{\"ok\":true}"; break;
                    case "/target": body = Target(ParseId(q["id"])); break;
                    case "/do": body = Do(q["cmd"], q["id"], q["action"]); break;
                    default: body = "{\"hello\":\"qudlink\",\"version\":2}"; break;
                }
            }
            catch (Exception e) { body = JsonConvert.SerializeObject(new { error = e.Message }); }
            try
            {
                var b = Encoding.UTF8.GetBytes(body);
                ctx.Response.ContentType = "application/json; charset=utf-8";
                ctx.Response.AddHeader("Access-Control-Allow-Origin", "*");
                ctx.Response.AddHeader("Cache-Control", "no-store");
                ctx.Response.OutputStream.Write(b, 0, b.Length);
                ctx.Response.Close();
            }
            catch { }
        }

        // Run on the game thread; returns null on timeout (game busy in a modal, etc).
        static string OnGame(Func<string> f, int timeoutMs, bool wake = false)
        {
            var gm = GameManager.Instance;
            if (gm == null) return null;
            string result = null;
            var done = new ManualResetEventSlim(false);
            gm.gameQueue.queueTask(() =>
            {
                try { result = f(); }
                catch (Exception e) { result = JsonConvert.SerializeObject(new { error = e.Message }); }
                finally { done.Set(); }
            });
            if (wake) Keyboard.PushMouseEvent("Command:CmdQudLinkWake"); // idle input loop only runs tasks when woken
            return done.Wait(timeoutMs) ? result : null;
        }

        static readonly Dictionary<string, byte[]> tileCache = new Dictionary<string, byte[]>();
        static readonly Dictionary<char, UnityEngine.Color32> Pal = new Dictionary<char, UnityEngine.Color32>();
        static UnityEngine.Color32 PalColor(char c)
        {
            if (Pal.Count == 0)
            {
                string map = "k0f3b3aK155352ra64a2eRd74200g009403G00c420b0048bdB0096ffc40a4b9C77bfcfmb154cfMda5bd6w98875fWcfc041yb1c9c3YffffffOe99f10of15f22";
                for (int i = 0; i < map.Length; i += 7)
                {
                    int v = Convert.ToInt32(map.Substring(i + 1, 6), 16);
                    Pal[map[i]] = new UnityEngine.Color32((byte)(v >> 16), (byte)(v >> 8), (byte)v, 255);
                }
            }
            return Pal.TryGetValue(c, out var col) ? col : Pal['y'];
        }

        static void ServeTile(HttpListenerContext ctx, string path, string f, string d)
        {
            byte[] png = null;
            string key = path + "|" + f + "|" + d;
            lock (tileCache) tileCache.TryGetValue(key, out png);
            if (png == null && !string.IsNullOrEmpty(path))
            {
                var done = new ManualResetEventSlim(false);
                GameManager.Instance.uiQueue.queueTask(() =>
                {
                    try
                    {
                        if (!SpriteManager.TryGetTextureInfo(path, out var info) || info?.texture == null) return;
                        var px = info.texture.GetPixels32(0);
                        int tw = info.texture.width;
                        var fg = PalColor(string.IsNullOrEmpty(f) ? 'y' : f[0]);
                        var dc = PalColor(string.IsNullOrEmpty(d) ? 'k' : d[0]);
                        var t = new UnityEngine.Texture2D(info.width, info.height, UnityEngine.TextureFormat.RGBA32, mipChain: false);
                        var outPx = new UnityEngine.Color32[info.width * info.height];
                        for (int y = 0; y < info.height; y++)
                            for (int x = 0; x < info.width; x++)
                            {
                                var c = px[(info.y + y) * tw + info.x + x];
                                if (c.a < 16) { outPx[y * info.width + x] = new UnityEngine.Color32(0, 0, 0, 0); continue; }
                                var src = (c.r + c.g + c.b) < 384 ? fg : dc;
                                outPx[y * info.width + x] = new UnityEngine.Color32(src.r, src.g, src.b, c.a);
                            }
                        t.SetPixels32(outPx); t.Apply();
                        png = UnityEngine.ImageConversion.EncodeToPNG(t);
                        UnityEngine.Object.Destroy(t);
                        lock (tileCache) tileCache[key] = png;
                    }
                    catch (Exception e) { UnityEngine.Debug.LogError("QudLink tile: " + e.Message); }
                    finally { done.Set(); }
                });
                done.Wait(2000);
            }
            try
            {
                if (png == null) { ctx.Response.StatusCode = 404; ctx.Response.Close(); return; }
                ctx.Response.ContentType = "image/png";
                ctx.Response.AddHeader("Access-Control-Allow-Origin", "*");
                ctx.Response.AddHeader("Cache-Control", "max-age=86400");
                ctx.Response.OutputStream.Write(png, 0, png.Length);
                ctx.Response.Close();
            }
            catch { }
        }

        // Game thread busy/idle: read directly. Reads can race with the game, so retry a couple of times.
        static string Direct(Func<string> f)
        {
            for (int i = 0; i < 3; i++)
            {
                try { return f(); } catch { Thread.Sleep(10); }
            }
            return null;
        }

        static int ParseId(string s) { int.TryParse(s, out var i); return i; }

        static int IdFor(GameObject go)
        {
            lock (idLock)
            {
                if (objToId.TryGetValue(go, out var id)) return id;
                id = nextId++;
                objToId[go] = id; idToObj[id] = go;
                return id;
            }
        }

        static GameObject ObjFor(int id)
        {
            lock (idLock) return idToObj.TryGetValue(id, out var go) && !go.IsInvalid() ? go : null;
        }

        static void PruneIds(HashSet<GameObject> live)
        {
            lock (idLock)
            {
                foreach (var go in objToId.Keys.Where(g => !live.Contains(g)).ToList())
                {
                    idToObj.Remove(objToId[go]); objToId.Remove(go);
                }
            }
        }

        static string Clean(string s) => string.IsNullOrEmpty(s) ? "" : ColorUtility.StripFormatting(s).Trim();

        static object ItemInfo(GameObject go, bool equipped, string slot = null) => new
        {
            id = IdFor(go),
            name = NameWithStats(go),
            count = go.Count,
            equipped,
            slot,
            category = go.GetInventoryCategory(),
            weight = go.Weight,
            tile = TileUrl(go),
        };

        // Qud only puts melee stats in the name for some weapons (ShowMeleeWeaponStats); add them for the rest.
        static string NameWithStats(GameObject go)
        {
            string n = go.DisplayName ?? "";
            try
            {
                var mw = go.GetPart<MeleeWeapon>();
                if (mw != null && !go.HasTagOrProperty("ShowMeleeWeaponStats") && go.Understood())
                {
                    string st = mw.GetSimplifiedStats(XRL.UI.Options.ShowDetailedWeaponStats);
                    if (!string.IsNullOrEmpty(st)) n += " " + st;
                }
            }
            catch { }
            return n;
        }

        static string TileUrl(GameObject go)
        {
            try
            {
                var r = go.RenderForUI();
                if (r == null || string.IsNullOrEmpty(r.Tile)) return null;
                string tc = ((IRenderable)r).getTileColor(); string cs = !string.IsNullOrEmpty(tc) ? tc : r.ColorString;
                char f = ColorUtility.FindLastForeground(cs ?? "") ?? 'y';
                char d = r.getDetailColor();
                if (d == (char)0 || d == ' ') d = 'k';
                return "/tile?p=" + Uri.EscapeDataString(r.Tile) + "&f=" + f + "&d=" + d;
            }
            catch { return null; }
        }

        static string BuildState()
        {
            var p = The.Player;
            if (p == null || The.Game == null || !The.Game.Running) return lastState = "{\"player\":null}";

            var live = new HashSet<GameObject>();
            var equipment = new List<object>();
            var body = p.Body?.GetBody();
            if (body != null)
            {
                foreach (var part in body.LoopParts())
                {
                    var eq = part.Equipped;
                    if (eq != null && live.Add(eq)) equipment.Add(ItemInfo(eq, true, Clean(part.GetOrdinalName())));
                }
            }

            var inventory = new List<object>();
            var inv = p.Inventory;
            if (inv != null)
                foreach (var go in inv.GetObjects())
                    if (live.Add(go)) inventory.Add(ItemInfo(go, false));
            var ground = new List<object>();
            var here = p.CurrentCell;
            if (here != null)
            {
                var cells = new List<Cell> { here };
                try { cells.AddRange(here.GetLocalAdjacentCells()); } catch { }
                foreach (var c in cells)
                {
                    string dir = c == here ? "here" : here.GetDirectionFromCell(c);
                    foreach (var o in c.Objects)
                    {
                        try
                        {
                            if (o == p || !o.IsTakeable() || o.IsCombatObject() || live.Contains(o)) continue;
                            if (o.Render == null || !o.Render.Visible) continue;
                            live.Add(o);
                            ground.Add(new { id = IdFor(o), name = NameWithStats(o), count = o.Count, tile = TileUrl(o), weight = o.Weight, dir });
                        }
                        catch { }
                    }
                }
            }
            var nearby = new List<object>();
            var zoneObj = p.CurrentZone; var pc = p.CurrentCell;
            if (zoneObj != null && pc != null)
            {
                foreach (var o in zoneObj.GetObjects())
                {
                    try
                    {
                        if (o == p || !o.IsCombatObject() || !o.IsVisible()) continue;
                        var oc = o.CurrentCell; if (oc == null) continue;
                        live.Add(o);
                        nearby.Add(new
                        {
                            id = IdFor(o), name = o.DisplayName ?? "", tile = TileUrl(o),
                            hp = o.hitpoints, maxhp = o.baseHitpoints,
                            dist = oc.PathDistanceTo(pc), x = oc.X, y = oc.Y,
                            hostile = o.IsHostileTowards(p),
                        });
                    }
                    catch { }
                }
            }
            PruneIds(live);

            string food = null, water = null;
            try { var st = p.GetPart<Stomach>(); if (st != null) { food = st.FoodStatus(); water = st.WaterStatus(); } } catch { }
            int drams = 0; try { drams = p.GetFreeDrams(); } catch { }
            int wt = 0, maxwt = 0; try { wt = p.GetCarriedWeight(); maxwt = p.GetMaxCarriedWeight(); } catch { }
            int lvl = p.Stat("Level"); int xpNext = 0; try { xpNext = Leveler.GetXPForLevel(lvl + 1); } catch { }

            var mutations = new List<object>();
            try { var m = p.GetPart<Mutations>(); if (m != null) foreach (var mu in m.MutationList) mutations.Add(new { name = mu.GetDisplayName(false) ?? "", level = mu.Level }); } catch { }
            var skills = new List<string>();
            try { var sk = p.GetPart<XRL.World.Parts.Skills>(); if (sk != null) foreach (var b in sk.SkillList) skills.Add(b.DisplayName ?? ""); } catch { }

            var quests = new List<object>();
            try
            {
                foreach (var kv in The.Game.Quests)
                {
                    var qu = kv.Value; if (qu == null || qu.Finished) continue;
                    var steps = new List<object>();
                    if (qu.StepsByID != null)
                        foreach (var stp in qu.StepsByID.Values.OrderBy(x => x.Ordinal))
                            if (!stp.Hidden) steps.Add(new { name = stp.Name ?? "", text = stp.Text ?? "", done = stp.Finished, failed = stp.Failed, optional = stp.Optional });
                    quests.Add(new { name = qu.Name ?? "", giver = qu.QuestGiverName ?? "", steps });
                }
            }
            catch { }

            var abilities = new List<object>();
            var aa = p.ActivatedAbilities;
            if (aa != null)
                foreach (var a in aa.GetAbilityListOrderedByPreference())
                    abilities.Add(new
                    {
                        cmd = a.Command,
                        name = a.DisplayName ?? "",
                        cooldown = a.CooldownRounds,
                        enabled = a.Enabled,
                        toggleable = a.Toggleable,
                        on = a.ToggleState,
                    });

            var stats = new Dictionary<string, int>();
            foreach (var kv in p.Statistics) stats[kv.Key] = kv.Value.Value;

            var effects = new List<object>();
            foreach (var e in p.Effects)
            {
                var d = Clean(e.GetDescription());
                if (d.Length > 0) effects.Add(new { name = d, details = Clean(e.GetDetails()) });
            }

            var notes = new List<string>();
            try { foreach (var n in Qud.API.JournalAPI.GeneralNotes) if (n.Revealed) notes.Add(n.Text ?? ""); } catch { }
            var log = new List<string>();
            var msgs = The.Game?.Player?.Messages?.Messages;
            if (msgs != null)
                for (int i = Math.Max(0, msgs.Count - 40); i < msgs.Count; i++) log.Add(msgs[i] ?? "");

            return lastState = JsonConvert.SerializeObject(new
            {
                player = new
                {
                    name = Clean(p.BaseDisplayName),
                    tile = TileUrl(p),
                    hp = p.hitpoints,
                    maxhp = p.baseHitpoints,
                    level = p.Stat("Level"),
                    xp = p.Stat("XP"),
                    zone = Clean(p.CurrentZone?.DisplayName),
                    xpNext, food, water, drams, weight = wt, maxweight = maxwt,
                    x = pc?.X ?? 0, y = pc?.Y ?? 0,
                },
                stats, effects, abilities, equipment, inventory, log, ground,
                nearby, quests, notes, mutations, skills,
                turn = The.Game?.Turns ?? 0,
            });
        }

        static Dictionary<string, InventoryAction> GetActions(GameObject owner, GameObject go)
        {
            var d = new Dictionary<string, InventoryAction>(16);
            if (go.HasRegisteredEvent("GetInventoryActions") || go.HasRegisteredEvent("GetInventoryActionsAlways") || owner.HasRegisteredEvent("OwnerGetInventoryActions"))
            {
                var v = new EventParameterGetInventoryActions(d);
                go.FireEvent(Event.New("GetInventoryActions", "Actions", v));
                go.FireEvent(Event.New("GetInventoryActionsAlways", "Actions", v));
                owner.FireEvent(Event.New("OwnerGetInventoryActions", "Actions", v, "Object", go));
            }
            GetInventoryActionsEvent.Send(owner, go, d);
            GetInventoryActionsAlwaysEvent.Send(owner, go, d);
            OwnerGetInventoryActionsEvent.Send(owner, go, d);
            return d;
        }

        static string BuildMap()
        {
            var p = The.Player; var z = p?.CurrentZone;
            if (z == null) return "{\"error\":\"no zone\"}";
            var glyphs = new StringBuilder(z.Width * z.Height);
            var colors = new StringBuilder(z.Width * z.Height);
            for (int y = 0; y < z.Height; y++)
                for (int x = 0; x < z.Width; x++)
                {
                    var c = z.GetCell(x, y);
                    char g = ' ', col = 'k';
                    if (c != null && c.IsExplored())
                    {
                        bool vis = c.IsVisible();
                        GameObject top = null; int layer = int.MinValue;
                        foreach (var o in c.Objects)
                        {
                            var r = o.Render;
                            if (r == null || !r.Visible) continue;
                            if (!vis && !o.IsWall()) continue; // remembered cells: walls only
                            if (r.RenderLayer > layer) { layer = r.RenderLayer; top = o; }
                        }
                        if (top != null)
                        {
                            var rs = top.Render.RenderString;
                            g = string.IsNullOrEmpty(rs) ? '?' : rs[0];
                            col = vis ? (ColorUtility.FindLastForeground(top.Render.ColorString ?? "") ?? 'y') : 'K';
                        }
                        else { g = '.'; col = vis ? 'K' : 'k'; }
                    }
                    glyphs.Append(g); colors.Append(col);
                }
            var pc = p.CurrentCell;
            return JsonConvert.SerializeObject(new { w = z.Width, h = z.Height, px = pc?.X ?? 0, py = pc?.Y ?? 0, glyphs = glyphs.ToString(), colors = colors.ToString() });
        }

        static string Describe(int id)
        {
            var go = ObjFor(id);
            if (go == null) return "{\"error\":\"not found\"}";
            string text;
            try { text = Look.GenerateTooltipContent(go); }
            catch { text = go.GetPart<Description>()?.GetShortDescription() ?? ""; }
            return JsonConvert.SerializeObject(new { id, name = go.DisplayName ?? "", tile = TileUrl(go), text });
        }

        static string Travel(int x, int y)
        {
            GameManager.Instance.gameQueue.queueTask(() =>
            {
                try
                {
                    var z = The.Player?.CurrentZone; var c = z?.GetCell(x, y);
                    if (c == null || c == The.Player.CurrentCell) return;
                    AutoAct.Setting = "M" + x + "," + y;
                }
                catch (Exception e) { UnityEngine.Debug.LogError("QudLink travel: " + e.Message); }
            });
            Keyboard.PushMouseEvent("Command:CmdQudLinkWake");
            return "{\"ok\":true}";
        }

        static string Target(int id)
        {
            GameManager.Instance.gameQueue.queueTask(() =>
            {
                var go = ObjFor(id);
                if (go != null) Sidebar.CurrentTarget = go;
            });
            Keyboard.PushMouseEvent("Command:CmdQudLinkWake");
            return "{\"ok\":true}";
        }

        static bool IsDistant(GameObject p, GameObject go)
        {
            var c = go.CurrentCell;
            return c != null && c != p.CurrentCell;
        }

        static string BuildActions(int id)
        {
            var p = The.Player; var go = ObjFor(id);
            if (p == null || go == null) return "{\"error\":\"item not found\"}";
            bool far = IsDistant(p, go);
            var list = GetActions(p, go).Values
                .Where(a => a.IsVisible(p, go, far))
                .OrderBy(a => a, new InventoryAction.Comparer { priorityFirst = true })
                .Select(a => new { cmd = a.Command, label = Clean(a.Display ?? a.Name), usable = a.IsUsable(p, go, far) })
                .ToList();
            return JsonConvert.SerializeObject(new { id, name = go.DisplayName ?? "", tile = TileUrl(go), actions = list });
        }

        static string Do(string cmd, string idStr, string action)
        {
            if (!string.IsNullOrEmpty(idStr) && !string.IsNullOrEmpty(action))
            {
                int id = ParseId(idStr);
                var gm = GameManager.Instance;
                gm.gameQueue.queueTask(() =>
                {
                    try
                    {
                        var p = The.Player; var go = ObjFor(id);
                        if (p == null || go == null) return;
                        var acts = GetActions(p, go);
                        bool far = IsDistant(p, go);
                        InventoryAction ia;
                        if (action == "__default")
                            ia = acts.Values.Where(a => a.IsVisible(p, go, far) && a.IsUsable(p, go, far)).OrderByDescending(a => a.Default).FirstOrDefault();
                        else if (!acts.TryGetValue(action, out ia))
                            ia = acts.Values.FirstOrDefault(a => a.Command == action);
                        if (ia == null || !ia.IsUsable(p, go, far, out var tk)) return;
                        ia.Process(go, p, tk);
                        go.CheckStack();
                    }
                    catch (Exception e) { UnityEngine.Debug.LogError("QudLink action: " + e); }
                });
                Keyboard.PushMouseEvent("Command:CmdQudLinkWake"); // wake input loop so turns advance
                return "{\"ok\":true}";
            }
            if (!string.IsNullOrEmpty(cmd))
            {
                if (!cmd.StartsWith("Cmd") && !cmd.StartsWith("Command") && cmd.IndexOf(' ') >= 0) return "{\"error\":\"bad cmd\"}";
                Keyboard.PushMouseEvent("Command:" + cmd);
                return "{\"ok\":true}";
            }
            return "{\"error\":\"missing cmd\"}";
        }
    }
}
