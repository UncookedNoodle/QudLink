// Loaded only via index.html#demo — fake state so the UI can be previewed without the game.
if (location.hash === "#demo") {
  const D = {player:{name:"Mehmet",hp:14,maxhp:22,level:4,xp:1320,xpNext:1800,zone:"{{G|Joppa}}, salt marsh",food:"{{g|Sated}}",water:"{{B|Quenched}}",drams:32,weight:142,maxweight:225,x:40,y:12},turn:4812,
    ground:[{id:30,name:"{{r|snapjaw corpse}} x2",count:2,dir:"here",weight:20},{id:31,name:"{{w|bronze battle axe}} {{c|→}}2 {{r|♥}}1d8",count:1,dir:"here",weight:8},{id:32,name:"waterskin {{y|[{{K|empty}}]}}",count:1,dir:"NE",weight:1}],
    nearby:[{id:20,name:"{{r|snapjaw scavenger}}",hp:9,maxhp:15,dist:4,x:44,y:10,hostile:true},{id:21,name:"{{g|watervine farmer}}",hp:20,maxhp:20,dist:7,x:34,y:15,hostile:false}],
    quests:[{name:"What's Eating the Watervine?",giver:"Elder Irudad",steps:[{name:"Travel to the Red Rock",text:"Find the cave north of Joppa.",done:true},{name:"Find the vermin",text:"Locate whatever is eating the watervine.",done:false}]}],
    notes:["The Joppa watervine farmers speak of a red rock to the north."],
    mutations:[{name:"Freezing Ray",level:3},{name:"Teleportation",level:2}],skills:["Axe","Cudgel","Survival"],
    stats:{HeatResistance:0,ColdResistance:15,ElectricResistance:0,AcidResistance:5,Strength:18,Agility:21,Toughness:16,Intelligence:14,Willpower:17,Ego:12,AV:4,DV:9,MA:2,Speed:100,MoveSpeed:100,XP:1320},
    effects:[{name:"{{g|well fed}}",details:"+1 regeneration"},{name:"{{r|bleeding}}",details:"Takes 1d2 damage per turn."}],
    abilities:[{cmd:"CommandSprint",name:"Sprint",cooldown:0,enabled:true,toggleable:true,on:false},
      {cmd:"CommandFreezingRay",name:"Freezing Ray",cooldown:12,enabled:true},{cmd:"CommandCharge",name:"Charge",cooldown:0,enabled:true},
      {cmd:"CommandMakeCamp",name:"Make Camp",cooldown:0,enabled:true}],
    equipment:[{id:1,name:"{{c|steel long sword}} {{r|♥}}2d4",count:1,slot:"Right Hand"},{id:2,name:"{{w|leather armor}}",count:1,slot:"Body"},
      {id:3,name:"{{amorous|love injector}}",count:1,slot:"Face"}],
    inventory:[{id:4,name:"{{Y|witchwood bark}}",count:3,category:"Food",weight:1},{id:5,name:"{{B|waterskin}} [{{b|32 drams of fresh water}}]",count:1,category:"Tools",weight:2},
      {id:6,name:"{{crystalline|crysteel dagger}}",count:1,category:"Melee Weapons",weight:3},{id:7,name:"{{R|salve injector}}",count:2,category:"Tonics",weight:0}],
    log:["You hit {{r|the snapjaw scavenger}} for {{R|5}} damage.","{{r|The snapjaw scavenger}} misses you.","You pick up {{Y|witchwood bark}}.","&GYou feel well fed.","The {{W|sun}} sets over the salt marsh."]};
  window.fetch = async (url) => {
    const u = new URL(url), p = u.pathname;
    const M=(()=>{let g="",c="";for(let y=0;y<25;y++)for(let x=0;x<80;x++){const w=x==0||y==0||x==79||y==24||(x>30&&x<50&&(y==5||y==18)&&x!=40);const r=Math.sin(x*7.1+y*3.3);g+=w?"#":r>.9?"\u0005":r>.75?"~":".";c+=w?"y":r>.9?"g":r>.75?"B":"K";}return {w:80,h:25,px:40,py:12,glyphs:g,colors:c}})();
    const body = p === "/map" ? M : p === "/describe" ? {name:"{{r|snapjaw scavenger}}",text:"A hunched, dog-faced humanoid.\n\n{{r|Hostile}} · Wounded"} : p === "/state" ? D : p === "/actions" ? {id:+u.searchParams.get("id"),name:"{{Y|witchwood bark}}",
      actions:[{cmd:"Eat",label:"{{W|e}}at",usable:true},{cmd:"Drop",label:"{{W|d}}rop",usable:true},{cmd:"Throw",label:"{{W|t}}hrow",usable:false}]} : {ok:true};
    return {ok:true, text: async () => JSON.stringify(body), json: async () => body};
  };
}
