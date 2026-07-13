#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(BeddrScreenTime, NSObject)

RCT_EXTERN_METHOD(getBlockedSelectionSummary:
                  (RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(requestAuthorizationAndSelectApps:
                  (RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(applyBlockedAppRestrictions:
                  (RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(clearBlockedAppRestrictions:
                  (RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

@end
