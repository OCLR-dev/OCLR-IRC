#import <Cocoa/Cocoa.h>
#import <Sparkle/Sparkle.h>
#include <node_api.h>

static SPUStandardUpdaterController *controller;

static napi_value start(napi_env env, napi_callback_info info) {
    if (![NSThread isMainThread]) {
        napi_throw_error(env, NULL, "Sparkle requires the main thread");
        return NULL;
    }
    if (!controller) {
        SPUStandardUpdaterController *updater = [[SPUStandardUpdaterController alloc] initWithStartingUpdater:NO updaterDelegate:nil userDriverDelegate:nil];
        if (![updater.updater startUpdater:NULL]) {
            napi_throw_error(env, NULL, "Could not start Sparkle");
            return NULL;
        }
        controller = updater;
    }
    return NULL;
}

static napi_value check(napi_env env, napi_callback_info info) {
    BOOL ready = [NSThread isMainThread] && controller.updater.canCheckForUpdates;
    if (ready) [controller checkForUpdates:nil];
    napi_value result;
    napi_get_boolean(env, ready, &result);
    return result;
}

NAPI_MODULE_INIT() {
    const napi_property_descriptor methods[] = {
        { "start", NULL, start, NULL, NULL, NULL, napi_default, NULL },
        { "check", NULL, check, NULL, NULL, NULL, napi_default, NULL }
    };
    napi_define_properties(env, exports, sizeof(methods) / sizeof(methods[0]), methods);
    return exports;
}
