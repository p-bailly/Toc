package fr.perso.toc;

import android.Manifest;
import android.app.Activity;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.webkit.JavascriptInterface;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.webkit.WebViewAssetLoader;

import org.json.JSONObject;

/**
 * L'appli Android du Toc : l'appli web (dossier public/, embarqué tel quel dans l'APK) affichée dans une WebView.
 * Les fichiers sont servis sans réseau sous {@link #ORIGINE} ; seul Firebase passe par Internet.
 *
 * Une WebView n'a ni notifications web, ni partage, ni barre de navigateur à colorer : la page les demande à cette
 * activité par l'objet JavaScript « TocAndroid » ({@link Pont}, côté web : public/js/ui/android.js).
 */
public class MainActivity extends Activity {
    private static final String ORIGINE = "https://appassets.androidplatform.net/";
    /** « sanssw » : pas de service worker, les fichiers sont déjà dans l'APK. */
    private static final String ACCUEIL = ORIGINE + "index.html?sanssw";
    private static final String CANAL = "tour";
    private static final String HASH = "hash";
    private static final String URL = "url";

    private WebView vue;

    @Override
    protected void onCreate(Bundle etat) {
        super.onCreate(etat);
        getSystemService(NotificationManager.class)
                .createNotificationChannel(new NotificationChannel(CANAL, getString(R.string.canal), NotificationManager.IMPORTANCE_DEFAULT));

        vue = new WebView(this);
        vue.setBackgroundColor(getColor(R.color.fond));
        setContentView(vue);

        WebSettings reglages = vue.getSettings();
        reglages.setJavaScriptEnabled(true);
        reglages.setDomStorageEnabled(true);
        // La taille du texte se choisit dans les Réglages de l'appli, comme sur le web.
        reglages.setTextZoom(100);

        WebViewAssetLoader fichiers = new WebViewAssetLoader.Builder()
                .addPathHandler("/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();
        vue.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest requete) {
                return fichiers.shouldInterceptRequest(requete.getUrl());
            }

            /** Un lien vers un autre site s'ouvre dans le navigateur. */
            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest requete) {
                if (requete.getUrl().toString().startsWith(ORIGINE)) return false;
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, requete.getUrl()));
                } catch (ActivityNotFoundException e) {
                    // aucune appli pour ce lien
                }
                return true;
            }

            /**
             * Le moteur de la page s'est arrêté. Sans cette méthode, Android ferme l'appli. Arrêté par le système
             * (mémoire) : on recharge le même écran. Planté : on quitte, pour ne pas replanter en boucle.
             */
            @Override
            public boolean onRenderProcessGone(WebView v, RenderProcessGoneDetail detail) {
                if (detail.didCrash()) finish();
                else recreate();
                return true;
            }
        });
        // Sans lui, confirm() répond toujours « non ».
        vue.setWebChromeClient(new WebChromeClient());
        vue.addJavascriptInterface(new Pont(), "TocAndroid");

        // Activité recréée (thème du téléphone changé, appli sortie de la mémoire) : on revient sur le même écran.
        String url = etat == null ? null : etat.getString(URL);
        if (url == null || !url.startsWith(ORIGINE)) url = ACCUEIL + hashDe(getIntent());
        vue.loadUrl(url);
    }

    /** Écran demandé par la notification touchée (« #/partie/abc »), ou rien. */
    private static String hashDe(Intent intention) {
        String hash = intention == null ? null : intention.getStringExtra(HASH);
        return hash != null && hash.startsWith("#") ? hash : "";
    }

    /** Notification touchée alors que l'appli est ouverte. */
    @Override
    protected void onNewIntent(Intent intention) {
        super.onNewIntent(intention);
        String hash = hashDe(intention);
        if (!hash.isEmpty()) signaler("toc-ouvrir", hash);
    }

    /** Une fois l'appli sous les yeux, ses notifications n'ont plus rien à annoncer. */
    @Override
    protected void onResume() {
        super.onResume();
        getSystemService(NotificationManager.class).cancelAll();
    }

    @Override
    protected void onSaveInstanceState(Bundle etat) {
        super.onSaveInstanceState(etat);
        etat.putString(URL, vue.getUrl());
    }

    @Override
    protected void onDestroy() {
        vue.destroy();
        super.onDestroy();
    }

    /** Retour : écran précédent de l'appli, puis sortie. */
    @Override
    public void onBackPressed() {
        if (vue.canGoBack()) vue.goBack();
        else super.onBackPressed();
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] permissions, int[] reponses) {
        super.onRequestPermissionsResult(code, permissions, reponses);
        signaler("toc-notifications", null);
    }

    /** Envoie un événement à la page : window.dispatchEvent(new CustomEvent(type, { detail })). */
    private void signaler(String type, String detail) {
        String valeur = detail == null ? "null" : JSONObject.quote(detail);
        vue.evaluateJavascript("window.dispatchEvent(new CustomEvent(" + JSONObject.quote(type) + ",{detail:" + valeur + "}))", null);
    }

    /** Barres du système (état, navigation) : couleur du thème de l'appli, icônes foncées sur un fond clair. */
    private void colorerBarres(int couleur, boolean sombre) {
        getWindow().setStatusBarColor(couleur);
        getWindow().setNavigationBarColor(couleur);
        View decor = getWindow().getDecorView();
        int clair = View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
        decor.setSystemUiVisibility(sombre ? decor.getSystemUiVisibility() & ~clair : decor.getSystemUiVisibility() | clair);
    }

    /** Ce que la page peut demander à l'appli. Appelé par la WebView hors du fil de l'interface. */
    private final class Pont {
        /** Version de l'APK (« 1.0.57 »), affichée dans les Réglages. */
        @JavascriptInterface
        public String version() {
            return BuildConfig.VERSION_NAME;
        }

        /** Adresse de la version web, pour les liens d'invitation. */
        @JavascriptInterface
        public String adresseWeb() {
            return BuildConfig.ADRESSE_WEB;
        }

        @JavascriptInterface
        public boolean notificationsAutorisees() {
            return getSystemService(NotificationManager.class).areNotificationsEnabled();
        }

        /** Demande l'autorisation au système si elle peut l'être ; la page reçoit ensuite « toc-notifications ». */
        @JavascriptInterface
        public void demanderNotifications() {
            runOnUiThread(() -> {
                if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED)
                    requestPermissions(new String[] {Manifest.permission.POST_NOTIFICATIONS}, 1);
                else signaler("toc-notifications", null);
            });
        }

        /** Notification qui, touchée, ouvre l'écran « hash ». Une notification de même clé remplace l'ancienne. */
        @JavascriptInterface
        public void notifier(String cle, String titre, String texte, String hash) {
            Intent ouvrir = new Intent(MainActivity.this, MainActivity.class).putExtra(HASH, hash);
            PendingIntent auToucher = PendingIntent.getActivity(
                    MainActivity.this, String.valueOf(cle).hashCode(), ouvrir, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            Notification notification = new Notification.Builder(MainActivity.this, CANAL)
                    .setSmallIcon(R.drawable.ic_notification)
                    .setColor(getColor(R.color.notification))
                    .setContentTitle(titre)
                    .setContentText(texte)
                    .setStyle(new Notification.BigTextStyle().bigText(texte))
                    .setContentIntent(auToucher)
                    .setAutoCancel(true)
                    .build();
            getSystemService(NotificationManager.class).notify(cle, 0, notification);
        }

        /** Feuille de partage d'Android (lien d'invitation). */
        @JavascriptInterface
        public void partager(String texte) {
            Intent envoi = new Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, texte);
            runOnUiThread(() -> startActivity(Intent.createChooser(envoi, null)));
        }

        /** Thème de l'appli changé : « couleur » est celle du haut de la page (« #a9d3f4 »). */
        @JavascriptInterface
        public void barres(String couleur, boolean sombre) {
            int valeur;
            try {
                valeur = Color.parseColor(couleur);
            } catch (RuntimeException e) {
                return;
            }
            runOnUiThread(() -> colorerBarres(valeur, sombre));
        }
    }
}
