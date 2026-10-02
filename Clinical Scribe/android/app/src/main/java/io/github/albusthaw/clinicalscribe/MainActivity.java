package io.github.albusthaw.clinicalscribe;

import android.content.Intent;
import android.os.Bundle;
import android.view.WindowManager;
import android.webkit.WebSettings;
import com.getcapacitor.BridgeActivity;

/**
 * The app window. It shows the app pages bundled inside the app, keeps patient
 * information out of screenshots and the recent apps list, and lets only the
 * app's own links through (LinkRules).
 */
public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(ScribeNativePlugin.class);
        // The page reads the link that opened the app while the window is created.
        keepOnlyAppLinks(getIntent());
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        if (getBridge() == null) return;
        WebSettings settings = getBridge().getWebView().getSettings();
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setGeolocationEnabled(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        keepOnlyAppLinks(intent);
        super.onNewIntent(intent);
    }

    /** Drops any link that is not one of the app's own before the page can see it. */
    private static void keepOnlyAppLinks(Intent intent) {
        if (intent == null || intent.getData() == null) return;
        if (!LinkRules.isAccepted(intent.getDataString())) intent.setData(null);
    }
}
