-- M0 spike, passe 2 : approfondissement EQ + playlist + metadonnees fichiers locaux.
-- Toute ecriture est restauree immediatement.

set out to {}

if application "Music" is not running then
	return "Music.app n'est pas lancee."
end if

tell application "Music"
	set end of out to "=== EQ : ACCES DIRECT PAR NOM (sans current EQ preset) ==="
	try
		set p to EQ preset "Rock"
		set end of out to "  EQ preset \"Rock\" : trouve, modifiable=" & (modifiable of p as text)
		set end of out to "  bandes = " & (band 1 of p as text) & " / " & (band 2 of p as text) & " / " & (band 10 of p as text)
		set end of out to "  preamp = " & (preamp of p as text)
		try
			set v to band 1 of p
			set band 1 of p to v
			set end of out to "  ECRITURE band 1 sur preset nomme (no-op) = OK"
		on error e number n
			set end of out to "  ECRITURE band 1 sur preset nomme = REFUSEE (" & n & "): " & e
		end try
	on error e number n
		set end of out to "  EQ preset \"Rock\" ERREUR (" & n & "): " & e
	end try

	set end of out to ""
	set end of out to "=== EQ : current EQ preset AVEC EQ ACTIVE (test reversible) ==="
	set eqWasEnabled to false
	try
		set eqWasEnabled to EQ enabled
		set end of out to "  etat initial EQ enabled = " & (eqWasEnabled as text)
		if not eqWasEnabled then
			set EQ enabled to true
			set end of out to "  -> EQ active temporairement"
		end if
		try
			set cep to current EQ preset
			set end of out to "  current EQ preset = " & (name of cep)
			set end of out to "  modifiable = " & (modifiable of cep as text)
			set bs to ""
			set bs to bs & (band 1 of cep as text) & " " & (band 2 of cep as text) & " " & (band 3 of cep as text)
			set bs to bs & " " & (band 4 of cep as text) & " " & (band 5 of cep as text) & " " & (band 6 of cep as text)
			set bs to bs & " " & (band 7 of cep as text) & " " & (band 8 of cep as text) & " " & (band 9 of cep as text)
			set bs to bs & " " & (band 10 of cep as text)
			set end of out to "  bandes 1-10 = " & bs
			try
				set v to band 5 of cep
				set band 5 of cep to v
				set end of out to "  ECRITURE band 5 (no-op) = OK"
			on error e number n
				set end of out to "  ECRITURE band 5 = REFUSEE (" & n & "): " & e
			end try
			try
				set current EQ preset to EQ preset "Rock"
				set end of out to "  ECRITURE current EQ preset -> Rock = OK (nouveau courant: " & (name of current EQ preset) & ")"
				set current EQ preset to cep
				set end of out to "  restaure -> " & (name of current EQ preset)
			on error e number n
				set end of out to "  ECRITURE current EQ preset = REFUSEE (" & n & "): " & e
			end try
		on error e number n
			set end of out to "  current EQ preset TOUJOURS INDISPONIBLE (" & n & "): " & e
		end try
	on error e number n
		set end of out to "  bloc EQ ERREUR (" & n & "): " & e
	end try
	try
		set EQ enabled to eqWasEnabled
		set end of out to "  etat EQ restaure a " & (eqWasEnabled as text)
	end try

	set end of out to ""
	set end of out to "=== PLAYLIST : numero d'erreur exact + contexte ==="
	try
		set cp to current playlist
		set end of out to "  current playlist = " & (name of cp)
	on error e number n
		set end of out to "  current playlist ERREUR numero " & n & " : " & e
	end try
	try
		set end of out to "  current stream title = " & (current stream title)
	on error e number n
		set end of out to "  current stream title ERREUR (" & n & ")"
	end try
	try
		set end of out to "  current stream URL = " & (current stream URL)
	on error e number n
		set end of out to "  current stream URL ERREUR (" & n & ")"
	end try
	try
		set ct to current track
		set cnt to container of ct
		set end of out to "  container of current track = " & (class of cnt as text) & " / " & (name of cnt)
	on error e number n
		set end of out to "  container of current track ERREUR (" & n & "): " & e
	end try
	try
		set end of out to "  nb playlists visibles = " & ((count of playlists) as text)
	on error e number n
		set end of out to "  count playlists ERREUR (" & n & ")"
	end try

	set end of out to ""
	set end of out to "=== F3.4 : bit rate / sample rate sur un FILE TRACK local ==="
	try
		set lib to library playlist 1
		set end of out to "  library playlist = " & (name of lib) & ", " & ((count of tracks of lib) as text) & " pistes"
		set found to false
		repeat with i from 1 to 40
			try
				set t to track i of lib
				if (class of t as text) contains "file track" then
					set end of out to "  file track trouve [" & i & "] : " & (name of t)
					set end of out to "    bit rate = " & (bit rate of t as text)
					set end of out to "    sample rate = " & (sample rate of t as text)
					set end of out to "    cloud status = " & (cloud status of t as text)
					set end of out to "    kind = " & (kind of t)
					set found to true
					exit repeat
				end if
			end try
		end repeat
		if not found then
			set end of out to "  aucun file track dans les 40 premieres pistes ; classes vues :"
			repeat with i from 1 to 5
				try
					set t to track i of lib
					set end of out to "    [" & i & "] " & (class of t as text) & " - " & (name of t) & " | bitrate=" & (bit rate of t as text) & " | sr=" & (sample rate of t as text)
				end try
			end repeat
		end if
	on error e number n
		set end of out to "  library playlist ERREUR (" & n & "): " & e
	end try

	set end of out to ""
	set end of out to "=== ARTWORK : cout et format ==="
	try
		set ct to current track
		set aw to artwork 1 of ct
		set end of out to "  artwork format = " & (format of aw as text)
		set end of out to "  artwork downloaded = " & (downloaded of aw as text)
		set theRaw to (raw data of aw)
		set end of out to "  raw data recupere, class = " & (class of theRaw as text)
	on error e number n
		set end of out to "  artwork ERREUR (" & n & "): " & e
	end try
end tell

set AppleScript's text item delimiters to linefeed
return out as text
