-- M0 spike (jetable) : que expose reellement Music.app via Apple Events ?
-- Ne lance JAMAIS Music.app. Aucune ecriture destructrice : les tests d'ecriture
-- reecrivent la valeur deja en place.

set out to {}

on probe(lbl, res)
	return "  " & lbl & " = " & res
end probe

if application "Music" is not running then
	return "Music.app n'est pas lancee -- spike impossible. Lance-la manuellement puis relance."
end if

set end of out to "=== ETAT GENERAL ==="
tell application "Music"
	try
		set end of out to my probe("version", version)
	end try
	try
		set end of out to my probe("player state", (player state as text))
	end try
	try
		set end of out to my probe("shuffle enabled", (shuffle enabled as text))
	end try
	try
		set end of out to my probe("shuffle mode", (shuffle mode as text))
	end try
	try
		set end of out to my probe("song repeat", (song repeat as text))
	end try
	try
		set end of out to my probe("fixed indexing", (fixed indexing as text))
	end try

	set end of out to ""
	set end of out to "=== PISTE COURANTE (F3.4 / streaming) ==="
	try
		set t to current track
		set end of out to my probe("class", (class of t as text))
		set end of out to my probe("name", (name of t))
		set end of out to my probe("artist", (artist of t))
		set end of out to my probe("album", (album of t))
		set end of out to my probe("duration (s)", (duration of t as text))
		try
			set end of out to my probe("persistent ID", (persistent ID of t))
		on error e
			set end of out to my probe("persistent ID", "ERREUR: " & e)
		end try
		try
			set end of out to my probe("database ID", (database ID of t as text))
		on error e
			set end of out to my probe("database ID", "ERREUR: " & e)
		end try
		try
			set end of out to my probe("bit rate (kbps)", (bit rate of t as text))
		on error e
			set end of out to my probe("bit rate", "ERREUR: " & e)
		end try
		try
			set end of out to my probe("sample rate (Hz)", (sample rate of t as text))
		on error e
			set end of out to my probe("sample rate", "ERREUR: " & e)
		end try
		try
			set end of out to my probe("cloud status", (cloud status of t as text))
		on error e
			set end of out to my probe("cloud status", "ERREUR: " & e)
		end try
		try
			set end of out to my probe("kind", (kind of t))
		end try
		try
			set end of out to my probe("index", (index of t as text))
		on error e
			set end of out to my probe("index", "ERREUR: " & e)
		end try
		try
			set end of out to my probe("nb artworks", (count of artworks of t) as text)
		on error e
			set end of out to my probe("nb artworks", "ERREUR: " & e)
		end try
	on error e
		set end of out to "  current track INDISPONIBLE: " & e
	end try

	set end of out to ""
	set end of out to "=== SPIKE 1 : QUEUE / CURRENT PLAYLIST ==="
	try
		set cp to current playlist
		set end of out to my probe("current playlist class", (class of cp as text))
		set end of out to my probe("current playlist name", (name of cp))
		try
			set end of out to my probe("special kind", (special kind of cp as text))
		end try
		try
			set nbt to (count of tracks of cp)
			set end of out to my probe("count of tracks", nbt as text)
		on error e
			set nbt to -1
			set end of out to my probe("count of tracks", "ERREUR: " & e)
		end try

		-- Reconstruction d'une pseudo-queue : index de la piste courante puis suivantes
		try
			set ct to current track
			set idx to index of ct
			set end of out to my probe("index piste courante dans cp", idx as text)
			set lim to idx + 5
			if nbt > 0 and lim > nbt then set lim to nbt
			set end of out to "  --- pistes suivantes (index " & (idx + 1) & " a " & lim & ") ---"
			if lim > idx then
				repeat with i from (idx + 1) to lim
					try
						set nt to track i of cp
						set end of out to "    [" & i & "] " & (name of nt) & " - " & (artist of nt)
					on error e
						set end of out to "    [" & i & "] ERREUR: " & e
					end try
				end repeat
			else
				set end of out to "    (aucune piste suivante lisible)"
			end if
		on error e
			set end of out to "  pseudo-queue INDISPONIBLE: " & e
		end try
	on error e
		set end of out to "  current playlist INDISPONIBLE: " & e
	end try

	set end of out to ""
	set end of out to "=== SPIKE 2 : EGALISEUR ==="
	try
		set end of out to my probe("EQ enabled", (EQ enabled as text))
	on error e
		set end of out to my probe("EQ enabled", "ERREUR: " & e)
	end try
	try
		set nbp to (count of EQ presets)
		set end of out to my probe("nb EQ presets", nbp as text)
		set modif to {}
		repeat with i from 1 to nbp
			try
				set p to EQ preset i
				if (modifiable of p) then set end of modif to (name of p)
			end try
		end repeat
		set end of out to my probe("presets modifiables", (count of modif) as text)
		repeat with m in modif
			set end of out to "    modifiable: " & m
		end repeat
	on error e
		set end of out to my probe("EQ presets", "ERREUR: " & e)
	end try
	try
		set cep to current EQ preset
		set end of out to my probe("current EQ preset", (name of cep))
		set end of out to my probe("  modifiable", (modifiable of cep as text))
		set end of out to my probe("  preamp", (preamp of cep as text))
		set bands to {}
		set end of bands to (band 1 of cep)
		set end of bands to (band 2 of cep)
		set end of bands to (band 3 of cep)
		set end of bands to (band 4 of cep)
		set end of bands to (band 5 of cep)
		set end of bands to (band 6 of cep)
		set end of bands to (band 7 of cep)
		set end of bands to (band 8 of cep)
		set end of bands to (band 9 of cep)
		set end of bands to (band 10 of cep)
		set bs to ""
		repeat with b in bands
			set bs to bs & (b as text) & " "
		end repeat
		set end of out to my probe("  bandes 1-10 (lecture)", bs)

		-- TEST ECRITURE NON DESTRUCTIF : on reecrit la valeur deja en place
		try
			set v1 to band 1 of cep
			set band 1 of cep to v1
			set end of out to my probe("  ECRITURE band 1 (no-op)", "OK")
		on error e
			set end of out to my probe("  ECRITURE band 1 (no-op)", "REFUSEE: " & e)
		end try
		try
			set current EQ preset to cep
			set end of out to my probe("  ECRITURE current EQ preset (no-op)", "OK")
		on error e
			set end of out to my probe("  ECRITURE current EQ preset (no-op)", "REFUSEE: " & e)
		end try
		try
			set eqs to EQ enabled
			set EQ enabled to eqs
			set end of out to my probe("  ECRITURE EQ enabled (no-op)", "OK")
		on error e
			set end of out to my probe("  ECRITURE EQ enabled (no-op)", "REFUSEE: " & e)
		end try
	on error e
		set end of out to my probe("current EQ preset", "ERREUR: " & e)
	end try

	set end of out to ""
	set end of out to "=== DIVERS (verifications PRD) ==="
	try
		set end of out to my probe("sound volume", (sound volume as text))
	end try
	try
		set end of out to my probe("player position (s)", (player position as text))
	end try
end tell

set AppleScript's text item delimiters to linefeed
return out as text
