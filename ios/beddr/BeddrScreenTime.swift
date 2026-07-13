import FamilyControls
import ManagedSettings
import SwiftUI
import UIKit

private let beddrAppGroupIdentifier = "group.com.dmao.beddr"
private let blockedSelectionStorageKey = "beddr.blockedFamilyActivitySelection"

@available(iOS 16.0, *)
private struct BeddrFamilyActivityPicker: View {
  @Binding var selection: FamilyActivitySelection
  let onDone: () -> Void

  var body: some View {
    NavigationView {
      FamilyActivityPicker(selection: $selection)
        .navigationTitle("Blocked Apps")
        .toolbar {
          ToolbarItem(placement: .confirmationAction) {
            Button("Done", action: onDone)
          }
        }
    }
  }
}

@objc(BeddrScreenTime)
class BeddrScreenTime: NSObject {
  private var pickerSelection: Any?
  private var pickerResolver: RCTPromiseResolveBlock?
  private var pickerRejecter: RCTPromiseRejectBlock?
  private weak var pickerController: UIViewController?

  @objc
  static func requiresMainQueueSetup() -> Bool {
    true
  }

  @objc
  func getBlockedSelectionSummary(
    _ resolve: RCTPromiseResolveBlock,
    rejecter reject: RCTPromiseRejectBlock
  ) {
    guard #available(iOS 16.0, *) else {
      resolve(summaryDictionary(isAvailable: false))
      return
    }

    let selection = loadSelection()
    resolve(summaryDictionary(selection: selection, isAvailable: true))
  }

  @objc
  func requestAuthorizationAndSelectApps(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    guard #available(iOS 16.0, *) else {
      reject("screen_time_unavailable", "Screen Time app selection requires iOS 16 or newer.", nil)
      return
    }

    Task { @MainActor in
      do {
        try await AuthorizationCenter.shared.requestAuthorization(for: .individual)
        presentPicker(resolve: resolve, rejecter: reject)
      } catch {
        reject("screen_time_authorization_failed", error.localizedDescription, error)
      }
    }
  }

  @objc
  func applyBlockedAppRestrictions(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    guard #available(iOS 16.0, *) else {
      reject("screen_time_unavailable", "Screen Time restrictions require iOS 16 or newer.", nil)
      return
    }

    Task {
      do {
        try await AuthorizationCenter.shared.requestAuthorization(for: .individual)
        let selection = loadSelection()
        let selectedCount = selection.applicationTokens.count +
          selection.categoryTokens.count +
          selection.webDomainTokens.count
        let managedSettingsStore = ManagedSettingsStore(named: .init("beddr.lockIn"))

        managedSettingsStore.shield.applications = selection.applicationTokens.isEmpty
          ? nil
          : selection.applicationTokens
        managedSettingsStore.shield.applicationCategories = selection.categoryTokens.isEmpty
          ? nil
          : .specific(selection.categoryTokens)
        managedSettingsStore.shield.webDomains = selection.webDomainTokens.isEmpty
          ? nil
          : selection.webDomainTokens

        resolve(summaryDictionary(selection: selection, isAvailable: true).merging([
          "applied": selectedCount > 0,
        ]) { _, new in new })
      } catch {
        reject("screen_time_apply_failed", error.localizedDescription, error)
      }
    }
  }

  @objc
  func clearBlockedAppRestrictions(
    _ resolve: RCTPromiseResolveBlock,
    rejecter reject: RCTPromiseRejectBlock
  ) {
    guard #available(iOS 16.0, *) else {
      resolve(summaryDictionary(isAvailable: false).merging([
        "cleared": false,
      ]) { _, new in new })
      return
    }

    let managedSettingsStore = ManagedSettingsStore(named: .init("beddr.lockIn"))
    managedSettingsStore.clearAllSettings()
    resolve(summaryDictionary(selection: loadSelection(), isAvailable: true).merging([
      "cleared": true,
    ]) { _, new in new })
  }

  @available(iOS 16.0, *)
  @MainActor
  private func presentPicker(
    resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    guard let presentingController = topViewController() else {
      reject("screen_time_no_presenter", "Could not find a view to present the Screen Time picker.", nil)
      return
    }

    var selection = loadSelection()
    let binding = Binding<FamilyActivitySelection>(
      get: { selection },
      set: { selection = $0 }
    )

    let picker = BeddrFamilyActivityPicker(selection: binding) { [weak self] in
      guard let self else { return }
      self.saveSelection(selection)
      self.pickerController?.dismiss(animated: true) {
        resolve(self.summaryDictionary(selection: selection, isAvailable: true))
        self.pickerResolver = nil
        self.pickerRejecter = nil
        self.pickerSelection = nil
        self.pickerController = nil
      }
    }

    pickerSelection = selection
    pickerResolver = resolve
    pickerRejecter = reject

    let hostingController = UIHostingController(rootView: picker)
    hostingController.modalPresentationStyle = .formSheet
    pickerController = hostingController
    presentingController.present(hostingController, animated: true)
  }

  @available(iOS 16.0, *)
  private func loadSelection() -> FamilyActivitySelection {
    guard
      let defaults = UserDefaults(suiteName: beddrAppGroupIdentifier),
      let data = defaults.data(forKey: blockedSelectionStorageKey),
      let selection = try? JSONDecoder().decode(FamilyActivitySelection.self, from: data)
    else {
      return FamilyActivitySelection()
    }

    return selection
  }

  @available(iOS 16.0, *)
  private func saveSelection(_ selection: FamilyActivitySelection) {
    guard
      let defaults = UserDefaults(suiteName: beddrAppGroupIdentifier),
      let data = try? JSONEncoder().encode(selection)
    else {
      return
    }

    defaults.set(data, forKey: blockedSelectionStorageKey)
  }

  @available(iOS 16.0, *)
  private func summaryDictionary(
    selection: FamilyActivitySelection = FamilyActivitySelection(),
    isAvailable: Bool
  ) -> [String: Any] {
    [
      "isAvailable": isAvailable,
      "selectedApps": selection.applicationTokens.count,
      "selectedCategories": selection.categoryTokens.count,
      "selectedWebDomains": selection.webDomainTokens.count,
    ]
  }

  private func summaryDictionary(isAvailable: Bool) -> [String: Any] {
    [
      "isAvailable": isAvailable,
      "selectedApps": 0,
      "selectedCategories": 0,
      "selectedWebDomains": 0,
    ]
  }

  @MainActor
  private func topViewController() -> UIViewController? {
    let scene = UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .first { $0.activationState == .foregroundActive }

    let root = scene?.windows.first { $0.isKeyWindow }?.rootViewController
    return topViewController(from: root)
  }

  @MainActor
  private func topViewController(from controller: UIViewController?) -> UIViewController? {
    if let navigationController = controller as? UINavigationController {
      return topViewController(from: navigationController.visibleViewController)
    }

    if let tabController = controller as? UITabBarController {
      return topViewController(from: tabController.selectedViewController)
    }

    if let presentedController = controller?.presentedViewController {
      return topViewController(from: presentedController)
    }

    return controller
  }
}
