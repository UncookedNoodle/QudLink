#!/usr/bin/env bash
# One-time: installs JDK 17 + Android SDK (platform 34, build-tools 34) under ~/.qudlink-sdk
set -euo pipefail
R=~/.qudlink-sdk; mkdir -p "$R"; cd "$R"
if [ ! -x jdk/bin/javac ]; then
  curl -fL -o jdk.tgz "https://api.adoptium.net/v3/binary/latest/17/ga/linux/x64/jdk/hotspot/normal/eclipse"
  mkdir -p jdk && tar xzf jdk.tgz -C jdk --strip-components=1 && rm jdk.tgz
fi
export JAVA_HOME="$R/jdk" PATH="$R/jdk/bin:$PATH"
if [ ! -x android/cmdline-tools/latest/bin/sdkmanager ]; then
  curl -fL -o clt.zip "https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip"
  mkdir -p android/cmdline-tools && unzip -q clt.zip -d android/cmdline-tools && mv android/cmdline-tools/cmdline-tools android/cmdline-tools/latest && rm clt.zip
fi
(yes || true) | android/cmdline-tools/latest/bin/sdkmanager --sdk_root="$R/android" --licenses >/dev/null || true
android/cmdline-tools/latest/bin/sdkmanager --sdk_root="$R/android" "platforms;android-34" "build-tools;34.0.0" "platform-tools"
echo "SDK ready in $R"
