@echo off
rem ---- A batch file to build tldr.xpi and tldr.update.rdf

echo Building .xpi and .update.rdf files...
echo Mobile:
call cfx xpi --force-mobile --output-file=tldr-mobile.xpi --update-link https://www.bennish.net/files/tldr-mobile.xpi --update-url https://www.bennish.net/files/tldr-mobile.update.rdf
move tldr.update.rdf tldr-mobile.update.rdf
echo Desktop:
call cfx xpi --update-link https://www.bennish.net/files/tldr.xpi --update-url https://www.bennish.net/files/tldr.update.rdf
