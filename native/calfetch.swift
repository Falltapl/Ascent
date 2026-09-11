// Reads Calendar.app events via EventKit and prints them as JSON.
//
// macOS attributes a TCC (privacy) prompt to the process that launched this
// binary, not to the binary itself. Launched from Terminal, Terminal gets the
// Calendar prompt; grant it once and every later run is silent.
//
// Usage:  calfetch [--days N] [--check]
import EventKit
import Foundation

struct Out: Encodable {
    var ok: Bool
    var reason: String?
    var calendars: [String]
    var events: [Ev]
}
struct Ev: Encodable {
    var uid: String
    var title: String
    var start: String
    var end: String?
    var allDay: Bool
    var location: String?
    var calendar: String
}

func emit(_ o: Out) -> Never {
    let enc = JSONEncoder()
    enc.outputFormatting = [.withoutEscapingSlashes]
    let data = (try? enc.encode(o)) ?? Data("{\"ok\":false,\"reason\":\"encode failed\"}".utf8)
    FileHandle.standardOutput.write(data)
    exit(o.ok ? 0 : 3)
}

let args = CommandLine.arguments
let days = args.firstIndex(of: "--days").flatMap { i -> Int? in
    i + 1 < args.count ? Int(args[i + 1]) : nil
} ?? 60
let checkOnly = args.contains("--check")

let store = EKEventStore()
let sem = DispatchSemaphore(value: 0)
var granted = false
var authErr: String?

if #available(macOS 14.0, *) {
    store.requestFullAccessToEvents { ok, err in
        granted = ok; authErr = err?.localizedDescription; sem.signal()
    }
} else {
    store.requestAccess(to: .event) { ok, err in
        granted = ok; authErr = err?.localizedDescription; sem.signal()
    }
}

if sem.wait(timeout: .now() + 30) == .timedOut {
    emit(Out(ok: false, reason: "timed_out_waiting_for_permission", calendars: [], events: []))
}
guard granted else {
    emit(Out(ok: false, reason: authErr ?? "access_denied", calendars: [], events: []))
}

let cals = store.calendars(for: .event)
if checkOnly {
    emit(Out(ok: true, reason: nil, calendars: cals.map(\.title), events: []))
}

let iso = ISO8601DateFormatter()
iso.formatOptions = [.withInternetDateTime]

let start = Calendar.current.date(byAdding: .day, value: -7, to: Date())!
let end = Calendar.current.date(byAdding: .day, value: days, to: Date())!
let pred = store.predicateForEvents(withStart: start, end: end, calendars: nil)

let evs: [Ev] = store.events(matching: pred).compactMap { e in
    guard let s = e.startDate else { return nil }
    return Ev(
        uid: e.eventIdentifier ?? "\(e.calendarItemIdentifier)",
        title: e.title ?? "(untitled)",
        start: iso.string(from: s),
        end: e.endDate.map { iso.string(from: $0) },
        allDay: e.isAllDay,
        location: e.location,
        calendar: e.calendar.title
    )
}

emit(Out(ok: true, reason: nil, calendars: cals.map(\.title), events: evs))
