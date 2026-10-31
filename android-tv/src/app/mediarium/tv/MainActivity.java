package app.mediarium.tv;

import android.app.Activity;
import android.app.AlertDialog;
import android.os.Bundle;
import android.graphics.Color;
import android.graphics.Rect;
import android.net.Uri;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.view.WindowInsets;
import android.view.MotionEvent;
import android.os.Build;
import android.os.SystemClock;
import android.view.inputmethod.InputMethodManager;
import android.webkit.*;
import android.widget.*;
import java.io.*;
import org.json.JSONArray;

public final class MainActivity extends Activity {
    private static final String ORIGIN = "http://192.168.4.52:8265";
    private WebView web;
    private FrameLayout root;
    private LinearLayout error;
    private long lastDirectionAt;
    private View customView;
    private AlertDialog exitDialog;
    private WebChromeClient.CustomViewCallback customCallback;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        getWindow().getDecorView().setSystemUiVisibility(5894);
        root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(17,24,32));
        web = new WebView(this);
        web.setBackgroundColor(Color.rgb(17,24,32));
        root.addView(web, new FrameLayout.LayoutParams(-1,-1));
        setContentView(root);
        WebSettings s=web.getSettings();
        s.setJavaScriptEnabled(true); s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false); s.setAllowContentAccess(false);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setUseWideViewPort(true); s.setLoadWithOverviewMode(true);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setUserAgentString(s.getUserAgentString()+" MediariumTV/0.3.0");
        CookieManager.getInstance().setAcceptThirdPartyCookies(web,false);
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest r) {
                return r.isForMainFrame() && !isLocal(r.getUrl());
            }
            @Override public void onPageFinished(WebView view,String url) {
                CookieManager.getInstance().flush();
            }
            @Override public void onReceivedError(WebView view,WebResourceRequest r,WebResourceError e) {
                if(r.isForMainFrame()) showError();
            }
            @Override public void onReceivedHttpError(WebView view,WebResourceRequest r,WebResourceResponse response) {
                if(r.isForMainFrame() && response.getStatusCode()>=500) showError();
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public void onShowCustomView(View v,CustomViewCallback callback) {
                if(customView!=null) { callback.onCustomViewHidden(); return; }
                customView=v; customCallback=callback; root.addView(v,new FrameLayout.LayoutParams(-1,-1));
            }
            @Override public void onHideCustomView() { hideCustom(); }
        });
        web.loadUrl(ORIGIN+"/watch");
    }
    private boolean isLocal(Uri u) { return "http".equals(u.getScheme()) && "192.168.4.52".equals(u.getHost()) && u.getPort()==8265; }
    private void showError() {
        if(error!=null) return;
        error=new LinearLayout(this); error.setOrientation(1); error.setGravity(17); error.setPadding(60,60,60,60); error.setBackgroundColor(Color.rgb(17,24,32));
        TextView text=new TextView(this);text.setText("Mediarium is unavailable\nCheck that the TV and server are on the home network.");text.setTextColor(Color.WHITE);text.setTextSize(24);text.setGravity(17);error.addView(text);
        Button retry=new Button(this);retry.setText("Try again");error.addView(retry);
        retry.setOnClickListener(v->{root.removeView(error);error=null;web.loadUrl(ORIGIN+"/watch");});
        root.addView(error,new FrameLayout.LayoutParams(-1,-1));retry.requestFocus();
    }
    private void hideCustom() { if(customView!=null){root.removeView(customView);customView=null;customCallback.onCustomViewHidden();customCallback=null;} }
    private boolean keyboardVisible() {
        if(Build.VERSION.SDK_INT>=30 && root.getRootWindowInsets()!=null) return root.getRootWindowInsets().isVisible(WindowInsets.Type.ime());
        Rect r=new Rect();root.getWindowVisibleDisplayFrame(r);return r.height()<root.getHeight()*0.75;
    }
    private void openKeyboard() {
        web.evaluateJavascript("(()=>{const r=document.activeElement.getBoundingClientRect();return [r.left+r.width/2,r.top+r.height/2,innerWidth]})()", result->{
            try {
                JSONArray a=new JSONArray(result);float scale=(float)(web.getWidth()/a.getDouble(2));
                float x=(float)a.getDouble(0)*scale,y=(float)a.getDouble(1)*scale;
                long now=SystemClock.uptimeMillis();
                MotionEvent down=MotionEvent.obtain(now,now,MotionEvent.ACTION_DOWN,x,y,0);
                MotionEvent up=MotionEvent.obtain(now,now+60,MotionEvent.ACTION_UP,x,y,0);
                web.dispatchTouchEvent(down);web.dispatchTouchEvent(up);down.recycle();up.recycle();
            } catch(Exception ignored) {}
        });
    }
    @Override public boolean dispatchKeyEvent(KeyEvent event) {
        int code=event.getKeyCode();
        if(error!=null || keyboardVisible() || (exitDialog!=null && exitDialog.isShowing())) return super.dispatchKeyEvent(event);
        String key=null;
        switch(code) {
            case KeyEvent.KEYCODE_DPAD_UP:key="up";break;
            case KeyEvent.KEYCODE_DPAD_DOWN:key="down";break;
            case KeyEvent.KEYCODE_DPAD_LEFT:key="left";break;
            case KeyEvent.KEYCODE_DPAD_RIGHT:key="right";break;
            case KeyEvent.KEYCODE_DPAD_CENTER:case KeyEvent.KEYCODE_ENTER:key="enter";break;
            case KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE:key="playpause";break;
            case KeyEvent.KEYCODE_MEDIA_PLAY:key="play";break;
            case KeyEvent.KEYCODE_MEDIA_PAUSE:key="pause";break;
        }
        if(key==null) return super.dispatchKeyEvent(event);
        if(event.getAction()==KeyEvent.ACTION_DOWN && code>=KeyEvent.KEYCODE_DPAD_UP && code<=KeyEvent.KEYCODE_DPAD_RIGHT) {
            long now=SystemClock.uptimeMillis();
            if(event.getRepeatCount()>0 && now-lastDirectionAt<95) return true;
            lastDirectionAt=now;
        }
        if(event.getAction()==KeyEvent.ACTION_DOWN) web.evaluateJavascript("window.tvRemote && window.tvRemote('"+key+"')", result->{
            if("\"input\"".equals(result)) openKeyboard();
        });
        return true;
    }
    @Override public void onBackPressed() {
        if(customView!=null){hideCustom();return;}
        web.evaluateJavascript("window.tvBack ? window.tvBack() : false",result->{
            if("true".equals(result))return;
            if(web.canGoBack())web.goBack();else exitDialog=new AlertDialog.Builder(this).setMessage("Leave Mediarium?").setPositiveButton("Leave",(d,w)->finish()).setNegativeButton("Stay",null).show();
        });
    }
    @Override protected void onPause() { web.evaluateJavascript("document.querySelectorAll('video').forEach(v=>v.pause());document.dispatchEvent(new Event('mediarium-pause'))",null);CookieManager.getInstance().flush();web.onPause();super.onPause(); }
    @Override protected void onResume() {super.onResume();if(web!=null)web.onResume();}
    @Override protected void onDestroy() {web.destroy();super.onDestroy();}
}
