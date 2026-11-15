package com.lege.ordine;

import android.content.Context;
import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;
import androidx.fragment.app.FragmentActivity;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.concurrent.Executor;

@CapacitorPlugin(name = "Bio")
public class BioPlugin extends Plugin {
    @PluginMethod
    public void auth(PluginCall call) {
        String title = call.getString("title", "Deblochează");
        String cancel = call.getString("cancel", "Anulează");
        FragmentActivity act = getActivity();
        if (act == null) { call.reject("no activity"); return; }
        Executor exec = ContextCompat.getMainExecutor(act);
        BiometricPrompt prompt = new BiometricPrompt(act, exec, new BiometricPrompt.AuthenticationCallback() {
            @Override
            public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult result) {
                call.resolve();
            }
            @Override
            public void onAuthenticationError(int errorCode, CharSequence errString) {
                call.reject(errString != null ? errString.toString() : "error");
            }
            @Override
            public void onAuthenticationFailed() {
                call.reject("failed");
            }
        });
        BiometricPrompt.PromptInfo info = new BiometricPrompt.PromptInfo.Builder()
            .setTitle(title)
            .setNegativeButtonText(cancel)
            .build();
        prompt.authenticate(info);
    }

    @PluginMethod
    public void has(PluginCall call) {
        BiometricManager bm = BiometricManager.from(getContext());
        int r = bm.canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG);
        call.resolve(new com.getcapacitor.JSObject().put("available", r == BiometricManager.BIOMETRIC_SUCCESS));
    }
}
