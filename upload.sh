#!/bin/bash

# halt on errors
set -o errexit

echo Rsyncing files to www.bennish.net...
rsync -vu tldr.* ben@kennish.net:bennish/files/
echo All done
