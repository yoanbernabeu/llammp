// M0 spike (jetable) : verifie que com.apple.Music.playerInfo arrive bien et
// dumpe les cles reelles de userInfo. Aucune ecriture, aucun Apple Event.
import Foundation

let center = DistributedNotificationCenter.default()
var count = 0

func dump(_ note: Notification, label: String) {
    count += 1
    let ts = ProcessInfo.processInfo.systemUptime
    print("--- [\(count)] \(label) @ uptime \(String(format: "%.2f", ts)) ---")
    print("  name: \(note.name.rawValue)")
    guard let info = note.userInfo else {
        print("  userInfo: (nil)")
        return
    }
    for key in info.keys.map({ "\($0)" }).sorted() {
        let value = info[key as NSString] ?? info[key as AnyHashable]
        let desc = String(describing: value ?? "nil")
        let trimmed = desc.count > 160 ? String(desc.prefix(160)) + "…" : desc
        print("  \(key) [\(type(of: value ?? "nil" as AnyObject))] = \(trimmed)")
    }
    fflush(stdout)
}

// La notification documentee du PRD
center.addObserver(forName: NSNotification.Name("com.apple.Music.playerInfo"),
                   object: nil, queue: nil) { dump($0, label: "playerInfo") }

// Filet : d'autres notifications que Music emet peut-etre
for name in ["com.apple.iTunes.playerInfo",
             "com.apple.Music.sourceSaved",
             "com.apple.Music.playerInfo.lockscreen"] {
    center.addObserver(forName: NSNotification.Name(name), object: nil, queue: nil) {
        dump($0, label: name)
    }
}

print("Listener actif. En attente de notifications de Music.app…")
fflush(stdout)

// Arret automatique apres la duree passee en argument (defaut 180 s)
let duration = CommandLine.arguments.count > 1 ? (Double(CommandLine.arguments[1]) ?? 180) : 180
DispatchQueue.main.asyncAfter(deadline: .now() + duration) {
    print("=== fin de la fenetre d'ecoute : \(count) notification(s) recue(s) ===")
    fflush(stdout)
    exit(0)
}

RunLoop.main.run()
