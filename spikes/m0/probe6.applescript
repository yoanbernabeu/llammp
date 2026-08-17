-- M0, complement : `play` avec objet en parametre direct est-il utilisable ?
-- ATTENTION : ce script INTERROMPT la lecture en cours. Il capture l'etat initial
-- pour permettre une reprise manuelle, joue une petite playlist de test,
-- puis met en PAUSE a la fin.
-- Verifie au passage :
--   (a) si `current playlist` se resout quand la source est une playlist de bibliotheque
--       -> reouvrirait le verdict du spike 1
--   (b) `next track` (F2.1, jamais teste)
--   (c) `play track i of playlist` (equivalent du double-clic Winamp)

set testPlaylist to "100 Classic Reggae Tracks"
set out to {}

if application "Music" is not running then
	return "Music.app n'est pas lancee."
end if

tell application "Music"
	set end of out to "=== ETAT INITIAL (a reprendre manuellement) ==="
	try
		set ct to current track
		set end of out to "  piste  : " & (name of ct)
		set end of out to "  artiste: " & (artist of ct)
		set end of out to "  album  : " & (album of ct)
		set end of out to "  position: " & (player position as text) & " s"
		set end of out to "  etat   : " & (player state as text)
	on error e number n
		set end of out to "  capture ERREUR (" & n & ")"
	end try

	set end of out to ""
	set end of out to "=== (1) play playlist \"" & testPlaylist & "\" ==="
	try
		play playlist testPlaylist
		set end of out to "  commande ACCEPTEE"
	on error e number n
		set end of out to "  REFUSEE (" & n & "): " & e
	end try
	delay 2
	try
		set end of out to "  player state = " & (player state as text)
		set ct to current track
		set end of out to "  piste courante = " & (name of ct) & " - " & (artist of ct)
		set end of out to "  class = " & (class of ct as text)
	on error e number n
		set end of out to "  lecture etat ERREUR (" & n & ")"
	end try

	set end of out to ""
	set end of out to "=== (2) current playlist DANS CE CONTEXTE (decisif) ==="
	try
		set cp to current playlist
		set end of out to "  *** RESOLUE *** = " & (name of cp) & " [" & (class of cp as text) & "]"
		set end of out to "  count of tracks = " & ((count of tracks of cp) as text)
		try
			set idx to index of (current track)
			set end of out to "  index piste courante = " & (idx as text)
			set nbt to (count of tracks of cp)
			set lim to idx + 3
			if lim > nbt then set lim to nbt
			if lim > idx then
				set end of out to "  --- PISTES SUIVANTES (la vraie file !) ---"
				repeat with i from (idx + 1) to lim
					set nt to track i of cp
					set end of out to "    [" & i & "] " & (name of nt) & " - " & (artist of nt)
				end repeat
			end if
		on error e number n
			set end of out to "  index/suivantes ERREUR (" & n & "): " & e
		end try
	on error e number n
		set end of out to "  TOUJOURS INDISPONIBLE (" & n & "): " & e
	end try

	set end of out to ""
	set end of out to "=== (3) next track (F2.1) ==="
	try
		set nBefore to name of current track
		next track
		delay 2
		set af to name of current track
		set end of out to "  avant = " & nBefore
		set end of out to "  apres = " & af
		if nBefore is not af then
			set end of out to "  -> CHANGEMENT CONFIRME"
		else
			set end of out to "  -> aucun changement detecte"
		end if
	on error e number n
		set end of out to "  next track ERREUR (" & n & "): " & e
	end try

	set end of out to ""
	set end of out to "=== (4) play track i of playlist (double-clic Winamp) ==="
	try
		play track 1 of playlist testPlaylist
		delay 2
		set end of out to "  commande ACCEPTEE -> " & (name of current track)
	on error e number n
		set end of out to "  REFUSEE (" & n & "): " & e
	end try

	set end of out to ""
	set end of out to "=== FIN : mise en pause ==="
	try
		pause
		set end of out to "  lecture mise en pause (etat = " & (player state as text) & ")"
	on error e number n
		set end of out to "  pause ERREUR (" & n & ")"
	end try
end tell

set AppleScript's text item delimiters to linefeed
return out as text
