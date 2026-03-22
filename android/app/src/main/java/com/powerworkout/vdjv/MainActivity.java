package com.powerworkout.vdjv;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    registerPlugin(NativeBankImportPlugin.class);
    registerPlugin(NativeAppUpdatePlugin.class);
    super.onCreate(savedInstanceState);
  }
}
