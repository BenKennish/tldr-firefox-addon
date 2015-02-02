#!/bin/bash

MOBILE_APP="firefox"

echo "Running cfx for attached Android device (using $MOBILE_APP)..."
cfx run -v --mobile-app $MOBILE_APP -a fennec-on-device -b /Users/ben/Documents/android-sdk-macosx/platform-tools/adb --force-mobile
