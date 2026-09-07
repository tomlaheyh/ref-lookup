@echo off
setlocal EnableExtensions EnableDelayedExpansion
rem ============================================================================
rem  delete.bat -- routine cleanup for the whole repo, run from the repo root.
rem
rem  Removes, from this folder and every folder beneath it:
rem     * anything sitting inside a _to_delete\ folder
rem     * *.tmp            left by an _atomic() write that crashed
rem     * *.pyc            and the __pycache__\ folders holding them
rem     * *-old.zip *-new.zip *-old.skill *-new.skill   packaging leftovers
rem     * "name (1).ext"   ONLY when name.ext sits beside it and is byte-identical
rem     * delete_these.*   inside a _cleanup\ folder -- a stale list
rem     * *-vUTC-MMDD-HHMM.*   file-ver twins, ALL of them
rem
rem  NEVER touches .git\, .gitattributes, .gitignore, this script, its own log,
rem  or delete-keep.txt -- nor anything delete-keep.txt protects.
rem
rem  The twins go too, deliberately. They are useful for a day or two of testing
rem  and then they are clutter: restoring one old file out of a repo that has
rem  moved on underneath it is more likely to break something than to fix it.
rem  The site folders are in git anyway. Exclude-DIR\ is gitignored, so ITS twins
rem  are the only copy -- which is the point of clearing them on a schedule
rem  rather than hoarding them.
rem
rem  NOT removed: *.part. Those are in-flight daily pulls, not crash debris, and
rem  deleting one mid-run would destroy the day being written. A stale one after
rem  a hard kill is harmless -- the next run truncates it.
rem
rem  PER-REPO CONFIG -- delete-keep.txt, beside this script:
rem     one path fragment per line; any file whose path contains one is skipped.
rem     Lines starting with # are comments, blank lines are ignored. Matching is
rem     case-insensitive and plain text -- no wildcards, no = or ! characters.
rem     Copy this script and that file into any repo and edit only the list.
rem
rem    delete.bat          count, confirm, delete
rem    delete.bat /list    show what would go, delete nothing
rem    delete.bat /y       no confirmation (for a scheduled run)
rem ============================================================================

cd /d "%~dp0"
set "ROOT=%CD%"
set "SELF=%~nx0"
set "KEEPFILE=delete-keep.txt"
set "LOG=%ROOT%\delete-log.txt"
set "LIST=%TEMP%\repo_delete_%RANDOM%.txt"

set "MODE=ASK"
for %%A in (%*) do (
    if /i "%%~A"=="/list" set "MODE=LIST"
    if /i "%%~A"=="/y"    set "MODE=GO"
)

rem ---- load the protect list -------------------------------------------------
set /a KEEPN=0
if exist "%ROOT%\%KEEPFILE%" (
    for /f "usebackq eol=# delims=" %%K in ("%ROOT%\%KEEPFILE%") do (
        set "K=%%K"
        if defined K (
            set /a KEEPN+=1
            set "KEEP!KEEPN!=%%K"
        )
    )
)

echo.
echo   scanning %ROOT%
if %KEEPN% GTR 0 (
    echo   %KEEPN% protect rule^(s^) from %KEEPFILE%:
    for /l %%I in (1,1,%KEEPN%) do echo       !KEEP%%I!
)
echo.
if exist "%LIST%" del /f /q "%LIST%" >nul 2>&1
type nul > "%LIST%"

set /a N=0
set /a KEPTDUP=0
set /a KEPTPROT=0

for /f "delims=" %%F in ('dir /b /s /a-d 2^>nul') do (
    set "P=%%F"
    set "N_=%%~nxF"
    set "B=%%~nF"
    set "X=%%~xF"
    set "D=%%~dpF"
    set "R=!P:%ROOT%=!"
    set "HIT="

    rem ---- never: the repo's own history, this script, its log, the keep list -
    rem  .gitattributes / .gitignore have no basename before the dot, so cmd's ~n is
    rem  empty for them and the name-based rules below behave unpredictably. Both were
    rem  offered for deletion on 2026-08-31; losing .gitattributes silently un-normalises
    rem  every line ending in the repo, and losing .gitignore would let "git add ." push
    rem  Exclude-DIR -- API key included -- to GitHub. Named here, never matched below.
    if "!R!"=="!R:\.git\=!" if /i not "!N_!"=="%SELF%" if /i not "!N_!"=="delete-log.txt" if /i not "!N_!"=="%KEEPFILE%" if /i not "!N_!"==".gitattributes" if /i not "!N_!"==".gitignore" (

        rem ---- anything the keep list protects --------------------------------
        set "PROT="
        for /l %%I in (1,1,%KEEPN%) do (
            if not defined PROT (
                for /f "delims=" %%K in ("!KEEP%%I!") do (
                    set "T=!R:%%K=!"
                    if not "!T!"=="!R!" set "PROT=1"
                )
            )
        )

        if not defined PROT (

            rem ---- parked in _to_delete: already judged dead, whatever it is --
            if not "!R!"=="!R:\_to_delete\=!" (
                set "HIT=_to_delete"
            ) else if /i "!X!"==".tmp" (
                set "HIT=tmp"
            ) else if /i "!X!"==".pyc" (
                set "HIT=pyc"
            ) else if /i "!B:~-4!"=="-old" (
                if /i "!X!"==".zip"   set "HIT=pkg"
                if /i "!X!"==".skill" set "HIT=pkg"
            ) else if /i "!B:~-4!"=="-new" (
                if /i "!X!"==".zip"   set "HIT=pkg"
                if /i "!X!"==".skill" set "HIT=pkg"
            )

            rem ---- stale report inside a _cleanup folder --------------------
            if not defined HIT if not "!R!"=="!R:\_cleanup\=!" (
                if /i "!N_:~0,13!"=="delete_these." set "HIT=stale"
            )

            rem ---- "name (1).ext": a duplicate ONLY if the twin is identical -
            if not defined HIT if "!B:~-4!"==" (1)" (
                set "ORIG=!D!!B:~0,-4!!X!"
                if exist "!ORIG!" (
                    fc /b "!P!" "!ORIG!" >nul 2>&1
                    if not errorlevel 1 (
                        set "HIT=dup"
                    ) else (
                        set /a KEPTDUP+=1
                    )
                ) else (
                    set /a KEPTDUP+=1
                )
            )

            rem ---- file-ver twins ------------------------------------------
            if not defined HIT if not "!B!"=="!B:-vUTC-=!" set "HIT=twin"

            if defined HIT (
                set /a N+=1
                >>"%LIST%" echo(!P!
            )
        ) else (
            set /a KEPTPROT+=1
        )
    )
)

if %N%==0 (
    echo   nothing to clean -- the repo is already tidy.
    if %KEPTDUP%  GTR 0 echo   ^(%KEPTDUP% "(1)" file^(s^) kept: no identical original beside them^)
    if %KEPTPROT% GTR 0 echo   ^(%KEPTPROT% file^(s^) protected by %KEEPFILE%^)
    del /f /q "%LIST%" >nul 2>&1
    echo.
    pause
    exit /b 10
)

echo   %N% file^(s^) to remove:
echo.
for /f "usebackq delims=" %%L in ("%LIST%") do echo     %%L
echo.
if %KEPTDUP%  GTR 0 echo   keeping %KEPTDUP% "(1)" file^(s^) -- no identical original beside them
if %KEPTPROT% GTR 0 echo   keeping %KEPTPROT% file^(s^) protected by %KEEPFILE%
echo.

if /i "%MODE%"=="LIST" (
    echo   /list -- nothing was deleted.
    del /f /q "%LIST%" >nul 2>&1
    echo.
    pause
    exit /b 0
)

if /i "%MODE%"=="ASK" (
    set "YN="
    set /p "YN=  delete these %N% file(s)?  type Y to confirm: "
    if /i not "!YN!"=="Y" (
        echo.
        echo   cancelled -- nothing was deleted.
        del /f /q "%LIST%" >nul 2>&1
        echo.
        pause
        exit /b 0
    )
)

echo. > "%LOG%"
echo delete.bat  %DATE% %TIME% >> "%LOG%"
echo root: %ROOT% >> "%LOG%"
if %KEPTPROT% GTR 0 echo protected by %KEEPFILE%: %KEPTPROT% file(s) >> "%LOG%"
echo. >> "%LOG%"

set /a OK=0
set /a FAIL=0
for /f "usebackq delims=" %%L in ("%LIST%") do (
    set "T=%%L"
    del /f /q "!T!" >nul 2>&1
    if exist "!T!" (
        set /a FAIL+=1
        echo FAILED  !T! >> "%LOG%"
    ) else (
        set /a OK+=1
        echo deleted !T! >> "%LOG%"
    )
)

rem ---- the shells left behind, once their contents are gone -----------------
set /a RD=0
for /f "delims=" %%D in ('dir /b /s /ad 2^>nul') do (
    set "P=%%D"
    set "R=!P:%ROOT%=!"
    if "!R!"=="!R:\.git\=!" (
        set "PROT="
        for /l %%I in (1,1,%KEEPN%) do (
            if not defined PROT (
                for /f "delims=" %%K in ("!KEEP%%I!") do (
                    set "T=!R:%%K=!"
                    if not "!T!"=="!R!" set "PROT=1"
                )
            )
        )
        if not defined PROT (
            set "NM=%%~nxD"
            if /i "!NM!"=="_to_delete" (
                rd /s /q "!P!" >nul 2>&1
                if not exist "!P!" set /a RD+=1
            )
            if /i "!NM!"=="__pycache__" (
                rd /s /q "!P!" >nul 2>&1
                if not exist "!P!" set /a RD+=1
            )
        )
    )
)

del /f /q "%LIST%" >nul 2>&1

echo.
echo   removed %OK% file^(s^), %RD% empty folder^(s^)
if %FAIL% GTR 0 (
    echo   %FAIL% could NOT be removed -- open in another program, or read-only.
    echo   see delete-log.txt
)
echo   log: %LOG%
echo.
pause
exit /b 0
