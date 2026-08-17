-- M0, complement : les playlists de la BIBLIOTHEQUE sont-elles lisibles ?
-- Distinct du spike 1, qui portait sur la FILE D'ATTENTE en cours de lecture.
-- Lecture seule. Ne declenche aucune lecture.

set out to {}

if application "Music" is not running then
	return "Music.app n'est pas lancee."
end if

tell application "Music"
	set end of out to "=== PLAYLISTS DE LA BIBLIOTHEQUE ==="
	try
		set pls to (every user playlist)
		set end of out to "  nb user playlists = " & ((count of pls) as text)
		set shown to 0
		repeat with p in pls
			if shown ≥ 6 then exit repeat
			try
				set nm to name of p
				set nbt to (count of tracks of p)
				set sk to (special kind of p as text)
				set end of out to "  - " & nm & " [" & (class of p as text) & ", special=" & sk & "] : " & (nbt as text) & " pistes"
				set shown to shown + 1
				-- lecture effective des premieres pistes
				if nbt > 0 then
					repeat with i from 1 to 3
						if i > nbt then exit repeat
						try
							set t to track i of p
							set end of out to "      [" & i & "] " & (name of t) & " - " & (artist of t) & " (" & (class of t as text) & ")"
						on error e number n
							set end of out to "      [" & i & "] ERREUR (" & n & ")"
						end try
					end repeat
				end if
			on error e number n
				set end of out to "  - playlist ERREUR (" & n & ")"
			end try
		end repeat
	on error e number n
		set end of out to "  user playlists ERREUR (" & n & "): " & e
	end try
end tell

set AppleScript's text item delimiters to linefeed
return out as text
