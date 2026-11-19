#!/usr/bin/env bash
set -euo pipefail
R=~/.qudlink-sdk; BT="$R/android/build-tools/34.0.0"; JAR="$R/android/platforms/android-34/android.jar"
export JAVA_HOME="$R/jdk" PATH="$R/jdk/bin:$PATH"
cd "$(dirname "$0")/app"; O=build; rm -rf $O; mkdir -p $O/res $O/classes $O/dex
"$BT/aapt2" compile --dir res -o $O/res.zip
"$BT/aapt2" link -o $O/base.apk -I "$JAR" --manifest AndroidManifest.xml -A assets $O/res.zip
javac -source 8 -target 8 -nowarn -cp "$JAR" -d $O/classes $(find src -name '*.java') 2>&1 | grep -v "bootstrap\|^1 warning" || true
"$BT/d8" --min-api 26 --lib "$JAR" --output $O/dex $(find $O/classes -name '*.class')
(cd $O && cp base.apk unsigned.apk && zip -qj unsigned.apk dex/classes.dex)
"$BT/zipalign" -f 4 $O/unsigned.apk $O/aligned.apk
KS=~/.qudlink-sdk/debug.keystore
[ -f $KS ] || keytool -genkeypair -keystore $KS -storepass android -keypass android -alias qudlink -keyalg RSA -validity 10000 -dname "CN=QudLink" >/dev/null 2>&1
"$BT/apksigner" sign --ks $KS --ks-pass pass:android --out ../QudLink.apk $O/aligned.apk
echo "Built: $(cd .. && pwd)/QudLink.apk"
