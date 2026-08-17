-- M0 spike, passe 4 : la notification playerInfo expose "Playlist PersistentID".
-- Cette playlist est-elle resoluble via ScriptingBridge, alors meme que
-- `current playlist` echoue avec -1731 ? C'est la derniere voie de secours
-- pour la fenetre Playlist (spike 1).
-- Lecture seule, aucune ecriture.

set targetPID to "8080B049BB9BDDC7"
set out to {}

if application "Music" is not running then
	return "Music.app n'est pas lancee."
end if

tell application "Music"
	set end of out to "=== RESOLUTION PAR persistent ID (cible " & targetPID & ") ==="
	try
		set matches to (every playlist whose persistent ID is targetPID)
		set end of out to "  playlists correspondantes = " & ((count of matches) as text)
		if (count of matches) > 0 then
			set pl to item 1 of matches
			set end of out to "  -> " & (name of pl) & " [" & (class of pl as text) & "]"
			try
				set end of out to "  count of tracks = " & ((count of tracks of pl) as text)
			on error e number n
				set end of out to "  count of tracks ERREUR (" & n & ")"
			end try
			try
				repeat with i from 1 to 5
					set t to track i of pl
					set end of out to "    [" & i & "] " & (name of t) & " - " & (artist of t)
				end repeat
			on error e number n
				set end of out to "    lecture pistes ERREUR (" & n & ")"
			end try
		end if
	on error e number n
		set end of out to "  recherche par persistent ID ERREUR (" & n & "): " & e
	end try

	set end of out to ""
	set end of out to "=== REPLI UI : playlist affichee dans la fenetre ==="
	try
		set bw to browser window 1
		set end of out to "  browser window 1 trouvee"
		try
			set v to view of bw
			set end of out to "  view = " & (name of v) & " [" & (class of v as text) & "]"
			set end of out to "  count of tracks = " & ((count of tracks of v) as text)
			try
				set end of out to "  persistent ID de la view = " & (persistent ID of v)
			end try
			repeat with i from 1 to 5
				try
					set t to track i of v
					set end of out to "    [" & i & "] " & (name of t) & " - " & (artist of t)
				end try
			end repeat
		on error e number n
			set end of out to "  view ERREUR (" & n & "): " & e
		end try
	on error e number n
		set end of out to "  browser window ERREUR (" & n & "): " & e
	end try

	set end of out to ""
	set end of out to "=== REPLI : reconstruire l'album via la bibliotheque ==="
	try
		set ct to current track
		set alb to album of ct
		set art to album artist of ct
		if art is "" then set art to artist of ct
		set end of out to "  album courant = " & alb & " / " & art
		set sameAlbum to (every track of library playlist 1 whose album is alb)
		set end of out to "  pistes de cet album dans la bibliotheque = " & ((count of sameAlbum) as text)
		if (count of sameAlbum) > 0 then
			repeat with i from 1 to (count of sameAlbum)
				if i > 8 then exit repeat
				set t to item i of sameAlbum
				set end of out to "    [" & (track number of t) & "] " & (name of t) & " (" & (class of t as text) & ")"
			end repeat
		end if
	on error e number n
		set end of out to "  reconstruction album ERREUR (" & n & "): " & e
	end try
end tell

set AppleScript's text item delimiters to linefeed
return out as text
