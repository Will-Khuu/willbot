// A tiny helper app that posts will-bot's Mac notifications under its own
// name and icon. Launched with a title and body, it posts one banner and
// quits. Clicking a banner relaunches it with no arguments, and it opens
// the installed will-bot window (or the page in a browser) and quits.

import AppKit
import UserNotifications

let pageURL = URL(string: "http://127.0.0.1:3000")!

func openWillBot() {
  let apps = FileManager.default.homeDirectoryForCurrentUser
    .appendingPathComponent("Applications/Chrome Apps.localized/will-bot.app")
  if FileManager.default.fileExists(atPath: apps.path) {
    NSWorkspace.shared.openApplication(at: apps, configuration: NSWorkspace.OpenConfiguration()) { _, _ in exit(0) }
  } else {
    NSWorkspace.shared.open(pageURL)
    exit(0)
  }
}

final class Delegate: NSObject, NSApplicationDelegate, UNUserNotificationCenterDelegate {
  func applicationWillFinishLaunching(_ notification: Notification) {
    UNUserNotificationCenter.current().delegate = self
  }

  func applicationDidFinishLaunching(_ notification: Notification) {
    let args = CommandLine.arguments.dropFirst().filter { !$0.hasPrefix("-psn") }
    guard args.count >= 2 else {
      // Launched by a click: the response arrives through the delegate. Quit if none does.
      DispatchQueue.main.asyncAfter(deadline: .now() + 5) { exit(0) }
      return
    }
    post(title: args[args.startIndex], body: args[args.startIndex + 1])
  }

  func post(title: String, body: String) {
    let center = UNUserNotificationCenter.current()
    center.requestAuthorization(options: [.alert]) { granted, _ in
      guard granted else { exit(1) }
      let content = UNMutableNotificationContent()
      content.title = title
      content.body = body
      let request = UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: nil)
      center.add(request) { _ in
        DispatchQueue.main.asyncAfter(deadline: .now() + 1) { exit(0) }
      }
    }
  }

  func userNotificationCenter(
    _ center: UNUserNotificationCenter,
    didReceive response: UNNotificationResponse,
    withCompletionHandler done: @escaping () -> Void
  ) {
    done()
    DispatchQueue.main.async { openWillBot() }
  }

  // Show the banner even while this helper is the app being launched.
  func userNotificationCenter(
    _ center: UNUserNotificationCenter,
    willPresent notification: UNNotification,
    withCompletionHandler done: @escaping (UNNotificationPresentationOptions) -> Void
  ) {
    done([.banner])
  }
}

let app = NSApplication.shared
let delegate = Delegate()
app.delegate = delegate
app.setActivationPolicy(.prohibited)
app.run()
