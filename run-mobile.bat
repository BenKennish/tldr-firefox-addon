@echo off

echo Running cfx for attached Android device...
rem (values for mobile-app include fennec (Nightly), fennec_aurora (Aurora), firefox_beta (Beta), and firefox (Release) 
cfx run -v --mobile-app fennec -a fennec-on-device -b "C:\Users\Ben\AppData\Local\Android\android-sdk\platform-tools\adb.exe" --force-mobile < nul
