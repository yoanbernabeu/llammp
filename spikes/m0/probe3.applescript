-- M0 spike, passe 3 : A LANCER PENDANT LA LECTURE D'UN ALBUM OU D'UNE PLAYLIST
-- DE LA BIBLIOTHEQUE (et non de la radio). C'est le contexte d'usage principal
-- de l'application ; les passes 1 et 2 ont ete faites sur iTunes Radio.
-- Aucune ecriture destructrice : les tests d'ecriture sont des no-op ou restaures.

set out to {}

if application "Music" is not running then
	return "Music.app n'est pas lancee."
end if

tell application "Music"
	set end of out to "=== CONTEXTE ==="
	set end of out to "  player state = " & (player state as text)
	set end of out to "  shuffle enabled = " & (shuffle enabled as text)
	set end of out to "  song repeat = " & (song repeat as text)
	set end of out to "  fixed indexing = " & (fixed indexing as text)
	try
		set ct to current track
		set end of out to "  piste = " & (name of ct) & " - " & (artist of ct)
		set end of out to "  class = " & (class of ct as text)
		set end of out to "  persistent ID = " & (persistent ID of ct)
		try
			set end of out to "  bit rate = " & (bit rate of ct as text)
			set end of out to "  sample rate = " & (sample rate of ct as text)
			set end of out to "  cloud status = " & (cloud status of ct as text)
		end try
		try
			set cnt to container of ct
			set end of out to "  container = " & (class of cnt as text) & " / " & (name of cnt)
		on error e number n
			set end of out to "  container ERREUR (" & n & ")"
		end try
	end try

	set end of out to ""
	set end of out to "=== SPIKE 1 : QUEUE ==="
	try
		set cp to current playlist
		set end of out to "  current playlist = " & (name of cp) & " [" & (class of cp as text) & "]"
		try
			set end of out to "  special kind = " & (special kind of cp as text)
		end try
		set nbt to -1
		try
			set nbt to (count of tracks of cp)
			set end of out to "  count of tracks = " & (nbt as text)
		on error e number n
			set end of out to "  count of tracks ERREUR (" & n & "): " & e
		end try
		try
			set idx to index of (current track)
			set end of out to "  index piste courante = " & (idx as text)
			set lim to idx + 5
			if nbt > 0 and lim > nbt then set lim to nbt
			if lim > idx then
				set end of out to "  --- pistes suivantes ---"
				repeat with i from (idx + 1) to lim
					try
						set nt to track i of cp
						set end of out to "    [" & i & "] " & (name of nt) & " - " & (artist of nt)
					on error e number n
						set end of out to "    [" & i & "] ERREUR (" & n & ")"
					end try
				end repeat
			else
				set end of out to "  (pas de piste suivante lisible)"
			end if
		on error e number n
			set end of out to "  index / pistes suivantes ERREUR (" & n & "): " & e
		end try
	on error e number n
		set end of out to "  current playlist ERREUR (" & n & "): " & e
	end try

	set end of out to ""
	set end of out to "=== SPIKE 2 : EQ DANS CE CONTEXTE ==="
	try
		set eqWas to EQ enabled
		set end of out to "  EQ enabled (lecture) = " & (eqWas as text)
		try
			set EQ enabled to (not eqWas)
			set end of out to "  ECRITURE EQ enabled -> " & ((not eqWas) as text) & " = OK"
			set EQ enabled to eqWas
			set end of out to "  restaure a " & (eqWas as text)
		on error e number n
			set end of out to "  ECRITURE EQ enabled = REFUSEE (" & n & "): " & e
		end try
	on error e number n
		set end of out to "  EQ enabled ERREUR (" & n & ")"
	end try
	try
		set cep to current EQ preset
		set end of out to "  current EQ preset = " & (name of cep) & " (modifiable=" & (modifiable of cep as text) & ")"
	on error e number n
		set end of out to "  current EQ preset ERREUR (" & n & "): " & e
	end try
end tell

set AppleScript's text item delimiters to linefeed
return out as text
