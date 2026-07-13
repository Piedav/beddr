//
//  DeviceActivityReportExtension.swift
//  DeviceActivityReportExtension
//
//  Created by David Mao on 7/12/26.
//

import DeviceActivity
import ExtensionKit
import SwiftUI

@main
struct DeviceActivityReportExtension: DeviceActivityReportExtension {
    var body: some DeviceActivityReportScene {
        // Create a report for each DeviceActivityReport.Context that your app supports.
        TotalActivityReport { totalActivity in
            TotalActivityView(totalActivity: totalActivity)
        }
        // Add more reports here...
    }
}
