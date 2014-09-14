@echo off

echo Running cfx for attached Android device...
cfx run -v --mobile-app firefox -a fennec-on-device -b "C:\Users\Ben\AppData\Local\Android\android-sdk\platform-tools\adb.exe" --force-mobile < nul
