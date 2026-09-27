package com.kavach.app;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Outline;
import android.graphics.Paint;
import android.graphics.RectF;
import android.graphics.Typeface;
import android.os.Bundle;
import android.util.Log;
import android.widget.Toast;
import android.view.View;
import android.view.ViewGroup;
import android.view.ViewOutlineProvider;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.widget.FrameLayout;

import androidx.annotation.NonNull;
import androidx.camera.core.CameraSelector;
import androidx.camera.core.ImageAnalysis;
import androidx.camera.core.ImageProxy;
import androidx.camera.core.Preview;
import androidx.camera.lifecycle.ProcessCameraProvider;
import androidx.camera.view.PreviewView;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.BridgeActivity;
import com.google.common.util.concurrent.ListenableFuture;
import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.objects.DetectedObject;
import com.google.mlkit.vision.objects.ObjectDetection;
import com.google.mlkit.vision.objects.defaults.ObjectDetectorOptions;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MainActivity extends BridgeActivity {

    private static final int CAMERA_PERMISSION = 100;
    private static final float MIN_CONFIDENCE = 0.35f;

    private FrameLayout rootLayout;
    private PreviewView cameraPreview;
    private DetectionOverlay detectionOverlay;
    private ProcessCameraProvider cameraProvider;

    private ImageAnalysis imageAnalysis;
    private ExecutorService analysisExecutor;

    private boolean cameraRequested = false;

    private com.google.mlkit.vision.objects.ObjectDetector objectDetector;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        WebView webView = getBridge().getWebView();

        webView.setBackgroundColor(Color.TRANSPARENT);

        ViewGroup webParent = (ViewGroup) webView.getParent();

        if (webParent != null) {
            webParent.removeView(webView);
        }

        rootLayout = new FrameLayout(this);
        rootLayout.setBackgroundColor(Color.TRANSPARENT);

        // Keep the WebView transparent and place it ABOVE the native camera.
        // This is required so the Three.js AR layer can render on top of the
        // live camera feed while the rest of the app UI remains in the WebView.

        cameraPreview = new PreviewView(this);

        cameraPreview.setImplementationMode(
                PreviewView.ImplementationMode.COMPATIBLE
        );

        cameraPreview.setScaleType(
                PreviewView.ScaleType.FILL_CENTER
        );

        cameraPreview.setVisibility(View.GONE);

        cameraPreview.setBackgroundColor(Color.TRANSPARENT);
        cameraPreview.setAlpha(1.0f);
        cameraPreview.setZ(0.0f);

        cameraPreview.setOutlineProvider(
                new ViewOutlineProvider() {
                    @Override
                    public void getOutline(
                            View view,
                            Outline outline
                    ) {
                        outline.setRoundRect(
                                0,
                                0,
                                view.getWidth(),
                                view.getHeight(),
                                dp(18)
                        );
                    }
                }
        );

        cameraPreview.setClipToOutline(true);

        rootLayout.addView(
                cameraPreview,
                new FrameLayout.LayoutParams(
                        1,
                        1
                )
        );

        detectionOverlay = new DetectionOverlay(this);

        detectionOverlay.setVisibility(View.GONE);
        detectionOverlay.setZ(1.0f);

        rootLayout.addView(
                detectionOverlay,
                new FrameLayout.LayoutParams(
                        1,
                        1
                )
        );

        // WebView MUST be added last so it stays above the camera and can
        // display transparent Three.js content over the live preview.
        rootLayout.addView(
                webView,
                new FrameLayout.LayoutParams(
                        FrameLayout.LayoutParams.MATCH_PARENT,
                        FrameLayout.LayoutParams.MATCH_PARENT
                )
        );

        setContentView(rootLayout);

        webView.setZ(2.0f);

        webView.addJavascriptInterface(
                new CameraBridge(),
                "KavachCamera"
        );

        analysisExecutor =
                Executors.newSingleThreadExecutor();

        ObjectDetectorOptions options =
                new ObjectDetectorOptions.Builder()
                        .setDetectorMode(
                                ObjectDetectorOptions.STREAM_MODE
                        )
                        .enableMultipleObjects()
                        .enableClassification()
                        .build();

        objectDetector =
                ObjectDetection.getClient(options);
    }

    private int dp(float value) {
        return Math.round(
                value *
                getResources()
                        .getDisplayMetrics()
                        .density
        );
    }

    private boolean isGenericLabel(String label) {

        if (label == null) {
            return true;
        }

        String value =
                label.trim()
                        .toLowerCase(Locale.US);

        return value.equals("home goods")
                || value.equals("fashion goods")
                || value.equals("food")
                || value.equals("plants")
                || value.equals("places")
                || value.equals("unknown")
                || value.equals("object")
                || value.equals("objects")
                || value.equals("indoor")
                || value.equals("outdoor");
    }

    private String getDisplayLabel(DetectedObject object) {

        if (object == null || object.getLabels().isEmpty()) {
            return "OBJECT DETECTED";
        }

        String raw =
                object.getLabels()
                        .get(0)
                        .getText();

        if (isGenericLabel(raw)) {
            return "OBJECT DETECTED";
        }

        return raw;
    }

    private float getConfidence(DetectedObject object) {

        if (object == null || object.getLabels().isEmpty()) {
            return 0f;
        }

        return object.getLabels()
                .get(0)
                .getConfidence();
    }

    private void requestCamera(
            float left,
            float top,
            float width,
            float height
    ) {

        cameraRequested = true;

        positionCamera(
                left,
                top,
                width,
                height
        );

        if (
                ContextCompat.checkSelfPermission(
                        this,
                        Manifest.permission.CAMERA
                ) != PackageManager.PERMISSION_GRANTED
        ) {

            ActivityCompat.requestPermissions(
                    this,
                    new String[]{
                            Manifest.permission.CAMERA
                    },
                    CAMERA_PERMISSION
            );

            return;
        }

        startCamera();
    }

    private void startCamera() {

        if (cameraPreview == null) {
            return;
        }

        cameraPreview.setVisibility(
                View.VISIBLE
        );

        detectionOverlay.setVisibility(
                View.VISIBLE
        );

        detectionOverlay.startAnimation();

        ListenableFuture<ProcessCameraProvider> future =
                ProcessCameraProvider.getInstance(this);

        future.addListener(
                () -> {

                    try {

                        cameraProvider = future.get();

                        Preview preview =
                                new Preview.Builder()
                                        .build();

                        preview.setSurfaceProvider(
                                cameraPreview.getSurfaceProvider()
                        );

                        imageAnalysis =
                                new ImageAnalysis.Builder()
                                        .setBackpressureStrategy(
                                                ImageAnalysis
                                                        .STRATEGY_KEEP_ONLY_LATEST
                                        )
                                        .build();

                        imageAnalysis.setAnalyzer(
                                analysisExecutor,
                                this::analyzeImage
                        );

                        cameraProvider.unbindAll();

                        cameraProvider.bindToLifecycle(
                                this,
                                CameraSelector.DEFAULT_BACK_CAMERA,
                                preview,
                                imageAnalysis
                        );

                        Log.d(
                                "KAVACH_CAMERA",
                                "Camera bound successfully: " +
                                        cameraPreview.getWidth() + "x" +
                                        cameraPreview.getHeight()
                        );

                    } catch (Exception e) {

                        Log.e("KAVACH_CAMERA", "CameraX failed to start", e);

                        runOnUiThread(() ->
                                Toast.makeText(
                                        MainActivity.this,
                                        "Camera failed: " + e.getClass().getSimpleName(),
                                        Toast.LENGTH_LONG
                                ).show()
                        );
                    }

                },
                ContextCompat.getMainExecutor(this)
        );
    }

    private void analyzeImage(
            ImageProxy imageProxy
    ) {

        if (imageProxy.getImage() == null) {

            imageProxy.close();

            return;
        }

        int imageWidth =
                imageProxy.getWidth();

        int imageHeight =
                imageProxy.getHeight();

        int rotation =
                imageProxy.getImageInfo()
                        .getRotationDegrees();

        InputImage image =
                InputImage.fromMediaImage(
                        imageProxy.getImage(),
                        rotation
                );

        objectDetector
                .process(image)
                .addOnSuccessListener(
                        detectedObjects -> {

                            sendDetectedObjectsToWeb(
                                    detectedObjects,
                                    imageWidth,
                                    imageHeight,
                                    rotation
                            );

                            updateDetectionOverlay(
                                    detectedObjects,
                                    imageWidth,
                                    imageHeight,
                                    rotation
                            );
                        }
                )
                .addOnFailureListener(
                        e -> e.printStackTrace()
                )
                .addOnCompleteListener(
                        task ->
                                imageProxy.close()
                );
    }

    private void updateDetectionOverlay(
            List<DetectedObject> detectedObjects,
            int imageWidth,
            int imageHeight,
            int rotation
    ) {

        if (detectionOverlay == null) {
            return;
        }

        List<OverlayObject> objects =
                new ArrayList<>();

        for (
                DetectedObject object :
                detectedObjects
        ) {

            float confidence =
                    getConfidence(object);

            if (confidence < MIN_CONFIDENCE) {
                continue;
            }

            String label =
                    getDisplayLabel(object);

            android.graphics.Rect box =
                    object.getBoundingBox();

            objects.add(
                    new OverlayObject(
                            label,
                            confidence,
                            box.left,
                            box.top,
                            box.width(),
                            box.height()
                    )
            );
        }

        runOnUiThread(
                () ->
                        detectionOverlay.setObjects(
                                objects,
                                imageWidth,
                                imageHeight,
                                rotation
                        )
        );
    }

    private void sendDetectedObjectsToWeb(
            List<DetectedObject> detectedObjects,
            int imageWidth,
            int imageHeight,
            int rotation
    ) {

        if (getBridge() == null) {
            return;
        }

        WebView webView =
                getBridge().getWebView();

        StringBuilder json =
                new StringBuilder("{");

        json.append("\"imageWidth\":")
                .append(imageWidth)
                .append(",");

        json.append("\"imageHeight\":")
                .append(imageHeight)
                .append(",");

        json.append("\"rotation\":")
                .append(rotation)
                .append(",");

        json.append("\"objects\":[");

        boolean firstObject = true;

        for (
                DetectedObject object :
                detectedObjects
        ) {

            float confidence =
                    getConfidence(object);

            if (confidence < MIN_CONFIDENCE) {
                continue;
            }

            android.graphics.Rect box =
                    object.getBoundingBox();

            String label =
                    getDisplayLabel(object);

            if (!firstObject) {
                json.append(",");
            }

            firstObject = false;

            json.append("{");

            json.append("\"label\":\"")
                    .append(
                            label.replace(
                                    "\"",
                                    "\\\""
                            )
                    )
                    .append("\",");

            json.append("\"confidence\":")
                    .append(confidence)
                    .append(",");

            json.append("\"left\":")
                    .append(box.left)
                    .append(",");

            json.append("\"top\":")
                    .append(box.top)
                    .append(",");

            json.append("\"width\":")
                    .append(box.width())
                    .append(",");

            json.append("\"height\":")
                    .append(box.height());

            json.append("}");
        }

        json.append("]}");

        String script =
                "window.dispatchEvent(" +
                "new CustomEvent(" +
                "'kavachObjectDetection'," +
                "{detail:" +
                json +
                "}" +
                ")" +
                ")";

        runOnUiThread(
                () ->
                        webView.evaluateJavascript(
                                script,
                                null
                        )
        );
    }

    private void positionCamera(
            float left,
            float top,
            float width,
            float height
    ) {

        if (cameraPreview == null) {
            return;
        }

        int finalLeft =
                Math.max(
                        0,
                        Math.round(left)
                );

        int finalTop =
                Math.max(
                        0,
                        Math.round(top)
                );

        int finalWidth =
                Math.max(
                        1,
                        Math.round(width)
                );

        int finalHeight =
                Math.max(
                        1,
                        Math.round(height)
                );

        Log.d(
                "KAVACH_CAMERA",
                "positionCamera left=" + finalLeft +
                        " top=" + finalTop +
                        " width=" + finalWidth +
                        " height=" + finalHeight +
                        " root=" + rootLayout.getWidth() + "x" + rootLayout.getHeight()
        );

        FrameLayout.LayoutParams params =
                (FrameLayout.LayoutParams)
                        cameraPreview
                                .getLayoutParams();

        params.width =
                finalWidth;

        params.height =
                finalHeight;

        params.leftMargin =
                finalLeft;

        params.topMargin =
                finalTop;

        cameraPreview.setLayoutParams(
                params
        );

        FrameLayout.LayoutParams overlayParams =
                (FrameLayout.LayoutParams)
                        detectionOverlay
                                .getLayoutParams();

        overlayParams.width =
                finalWidth;

        overlayParams.height =
                finalHeight;

        overlayParams.leftMargin =
                finalLeft;

        overlayParams.topMargin =
                finalTop;

        detectionOverlay.setLayoutParams(
                overlayParams
        );

        // Do not bring the native overlay above the WebView.
        // The WebView must remain the top layer for the Three.js AR scene.

        detectionOverlay.setCameraSize(
                finalWidth,
                finalHeight
        );
    }

    private void updateCamera(
            float left,
            float top,
            float width,
            float height
    ) {

        if (!cameraRequested) {
            return;
        }

        positionCamera(
                left,
                top,
                width,
                height
        );
    }

    private void stopCamera() {

        cameraRequested = false;

        if (cameraProvider != null) {

            cameraProvider.unbindAll();

            cameraProvider = null;
        }

        if (imageAnalysis != null) {

            imageAnalysis.clearAnalyzer();

            imageAnalysis = null;
        }

        if (cameraPreview != null) {

            cameraPreview.setVisibility(
                    View.GONE
            );
        }

        if (detectionOverlay != null) {

            detectionOverlay.stopAnimation();

            detectionOverlay.clearObjects();

            detectionOverlay.setVisibility(
                    View.GONE
            );
        }
    }

    @Override
    public void onRequestPermissionsResult(
            int requestCode,
            @NonNull String[] permissions,
            @NonNull int[] grantResults
    ) {

        super.onRequestPermissionsResult(
                requestCode,
                permissions,
                grantResults
        );

        if (
                requestCode == CAMERA_PERMISSION &&
                cameraRequested &&
                grantResults.length > 0 &&
                grantResults[0] ==
                        PackageManager.PERMISSION_GRANTED
        ) {

            startCamera();

        } else if (
                requestCode == CAMERA_PERMISSION
        ) {

            Toast.makeText(
                    this,
                    "Camera permission was denied",
                    Toast.LENGTH_LONG
            ).show();
        }
    }

    @Override
    public void onDestroy() {

        stopCamera();

        if (objectDetector != null) {

            objectDetector.close();

            objectDetector = null;
        }

        if (analysisExecutor != null) {

            analysisExecutor.shutdown();

            analysisExecutor = null;
        }

        super.onDestroy();
    }

    private class CameraBridge {

        @JavascriptInterface
        public void start(
                float left,
                float top,
                float width,
                float height
        ) {

            runOnUiThread(
                    () ->
                            requestCamera(
                                    left,
                                    top,
                                    width,
                                    height
                            )
            );
        }

        @JavascriptInterface
        public void update(
                float left,
                float top,
                float width,
                float height
        ) {

            runOnUiThread(
                    () ->
                            updateCamera(
                                    left,
                                    top,
                                    width,
                                    height
                            )
            );
        }

        @JavascriptInterface
        public void stop() {

            runOnUiThread(
                    MainActivity.this::stopCamera
            );
        }
    }

    private static class OverlayObject {

        String label;
        float confidence;

        float left;
        float top;
        float width;
        float height;

        OverlayObject(
                String label,
                float confidence,
                float left,
                float top,
                float width,
                float height
        ) {

            this.label = label;
            this.confidence = confidence;

            this.left = left;
            this.top = top;
            this.width = width;
            this.height = height;
        }
    }

    private static class DetectionOverlay
            extends View {

        private final Paint fillPaint =
                new Paint(Paint.ANTI_ALIAS_FLAG);

        private final Paint outlinePaint =
                new Paint(Paint.ANTI_ALIAS_FLAG);

        private final Paint labelPaint =
                new Paint(Paint.ANTI_ALIAS_FLAG);

        private final Paint labelTextPaint =
                new Paint(Paint.ANTI_ALIAS_FLAG);

        private final Paint hudBackgroundPaint =
                new Paint(Paint.ANTI_ALIAS_FLAG);

        private final Paint hudTextPaint =
                new Paint(Paint.ANTI_ALIAS_FLAG);

        private final Paint smallTextPaint =
                new Paint(Paint.ANTI_ALIAS_FLAG);

        private final Paint scanPaint =
                new Paint(Paint.ANTI_ALIAS_FLAG);

        private final Paint dotPaint =
                new Paint(Paint.ANTI_ALIAS_FLAG);

        private List<OverlayObject> objects =
                new ArrayList<>();

        private int imageWidth = 1;
        private int imageHeight = 1;
        private int rotation = 0;

        private int cameraWidth = 1;
        private int cameraHeight = 1;

        private float scanPosition = 0;

        private boolean animationRunning = false;

        private final Runnable animationRunnable =
                new Runnable() {

                    @Override
                    public void run() {

                        if (!animationRunning) {
                            return;
                        }

                        scanPosition += dp(3);

                        if (scanPosition > cameraHeight) {
                            scanPosition = 0;
                        }

                        invalidate();

                        postDelayed(
                                this,
                                35
                        );
                    }
                };

        DetectionOverlay(Context context) {

            super(context);

            setWillNotDraw(false);

            outlinePaint.setStyle(
                    Paint.Style.STROKE
            );

            outlinePaint.setStrokeWidth(
                    dp(2.5f)
            );

            outlinePaint.setStrokeCap(
                    Paint.Cap.ROUND
            );

            fillPaint.setStyle(
                    Paint.Style.FILL
            );

            labelPaint.setStyle(
                    Paint.Style.FILL
            );

            labelTextPaint.setColor(
                    Color.WHITE
            );

            labelTextPaint.setTextSize(
                    dp(13)
            );

            labelTextPaint.setTypeface(
                    Typeface.create(
                            Typeface.DEFAULT,
                            Typeface.BOLD
                    )
            );

            hudBackgroundPaint.setStyle(
                    Paint.Style.FILL
            );

            hudTextPaint.setColor(
                    Color.WHITE
            );

            hudTextPaint.setTextSize(
                    dp(15)
            );

            hudTextPaint.setTypeface(
                    Typeface.create(
                            Typeface.DEFAULT,
                            Typeface.BOLD
                    )
            );

            smallTextPaint.setColor(
                    Color.argb(
                            210,
                            225,
                            255,
                            239
                    )
            );

            smallTextPaint.setTextSize(
                    dp(10)
            );

            scanPaint.setColor(
                    Color.argb(
                            75,
                            52,
                            211,
                            153
                    )
            );

            scanPaint.setStyle(
                    Paint.Style.FILL
            );

            dotPaint.setColor(
                    Color.rgb(
                            52,
                            211,
                            153
                    )
            );

            setClickable(false);
            setFocusable(false);

            setLayerType(
                    View.LAYER_TYPE_SOFTWARE,
                    null
            );
        }

        private int dp(float value) {

            return Math.round(
                    value *
                    getResources()
                            .getDisplayMetrics()
                            .density
            );
        }

        void startAnimation() {

            if (animationRunning) {
                return;
            }

            animationRunning = true;
            scanPosition = 0;

            removeCallbacks(
                    animationRunnable
            );

            post(animationRunnable);
        }

        void stopAnimation() {

            animationRunning = false;

            removeCallbacks(
                    animationRunnable
            );
        }

        void setCameraSize(
                int width,
                int height
        ) {

            cameraWidth =
                    Math.max(
                            1,
                            width
                    );

            cameraHeight =
                    Math.max(
                            1,
                            height
                    );

            invalidate();
        }

        void setObjects(
                List<OverlayObject> objects,
                int imageWidth,
                int imageHeight,
                int rotation
        ) {

            this.objects =
                    objects != null
                            ? objects
                            : new ArrayList<>();

            this.imageWidth =
                    Math.max(
                            1,
                            imageWidth
                    );

            this.imageHeight =
                    Math.max(
                            1,
                            imageHeight
                    );

            this.rotation = rotation;

            invalidate();
        }

        void clearObjects() {

            objects.clear();

            invalidate();
        }

        @Override
        protected void onDraw(Canvas canvas) {

            super.onDraw(canvas);

            drawTopHud(canvas);
            drawDetections(canvas);
            drawScanningLine(canvas);
            drawBottomHud(canvas);
        }

        private void drawTopHud(Canvas canvas) {

            int margin = dp(14);
            int top = dp(14);
            int hudHeight = dp(64);

            RectF hud =
                    new RectF(
                            margin,
                            top,
                            cameraWidth - margin,
                            top + hudHeight
                    );

            hudBackgroundPaint.setColor(
                    Color.argb(
                            175,
                            4,
                            12,
                            10
                    )
            );

            canvas.drawRoundRect(
                    hud,
                    dp(18),
                    dp(18),
                    hudBackgroundPaint
            );

            dotPaint.setColor(
                    Color.rgb(
                            52,
                            211,
                            153
                    )
            );

            canvas.drawCircle(
                    margin + dp(18),
                    top + dp(21),
                    dp(5),
                    dotPaint
            );

            hudTextPaint.setTextSize(dp(14));

            canvas.drawText(
                    "KAVACH",
                    margin + dp(32),
                    top + dp(25),
                    hudTextPaint
            );

            smallTextPaint.setTextSize(dp(10));

            canvas.drawText(
                    "AI SCANNING OBJECTS",
                    margin + dp(32),
                    top + dp(44),
                    smallTextPaint
            );

            Paint livePaint =
                    new Paint(Paint.ANTI_ALIAS_FLAG);

            livePaint.setColor(
                    Color.argb(
                            225,
                            52,
                            211,
                            153
                    )
            );

            livePaint.setTextSize(dp(9));

            livePaint.setTypeface(
                    Typeface.create(
                            Typeface.DEFAULT,
                            Typeface.BOLD
                    )
            );

            String liveText = "LIVE ANALYSIS";

            float liveWidth =
                    livePaint.measureText(liveText);

            canvas.drawText(
                    liveText,
                    cameraWidth -
                            margin -
                            liveWidth -
                            dp(14),
                    top + dp(24),
                    livePaint
            );

            Paint linePaint =
                    new Paint(Paint.ANTI_ALIAS_FLAG);

            linePaint.setColor(
                    Color.argb(
                            120,
                            52,
                            211,
                            153
                    )
            );

            linePaint.setStrokeWidth(dp(1));

            canvas.drawLine(
                    cameraWidth -
                            margin -
                            liveWidth -
                            dp(14),
                    top + dp(33),
                    cameraWidth -
                            margin -
                            dp(14),
                    top + dp(33),
                    linePaint
            );

            smallTextPaint.setTextSize(dp(9));

            String count =
                    objects.size() +
                    " OBJECT" +
                    (
                            objects.size() == 1
                                    ? ""
                                    : "S"
                    ) +
                    " DETECTED";

            float countWidth =
                    smallTextPaint.measureText(count);

            canvas.drawText(
                    count,
                    cameraWidth -
                            margin -
                            countWidth -
                            dp(14),
                    top + dp(49),
                    smallTextPaint
            );
        }

        private void drawDetections(Canvas canvas) {

            if (
                    objects.isEmpty() ||
                    imageWidth <= 0 ||
                    imageHeight <= 0
            ) {
                return;
            }

            float rotatedWidth;
            float rotatedHeight;

            if (
                    rotation == 90 ||
                    rotation == 270
            ) {

                rotatedWidth = imageHeight;
                rotatedHeight = imageWidth;

            } else {

                rotatedWidth = imageWidth;
                rotatedHeight = imageHeight;
            }

            float scale =
                    Math.max(
                            cameraWidth / rotatedWidth,
                            cameraHeight / rotatedHeight
                    );

            float displayedWidth =
                    rotatedWidth * scale;

            float displayedHeight =
                    rotatedHeight * scale;

            float cropX =
                    (displayedWidth - cameraWidth) / 2f;

            float cropY =
                    (displayedHeight - cameraHeight) / 2f;

            for (OverlayObject object : objects) {

                RectF mapped =
                        mapBoundingBox(
                                object,
                                scale,
                                cropX,
                                cropY
                        );

                if (
                        mapped.right < 0 ||
                        mapped.bottom < 0 ||
                        mapped.left > cameraWidth ||
                        mapped.top > cameraHeight
                ) {
                    continue;
                }

                mapped.left =
                        Math.max(
                                dp(3),
                                mapped.left
                        );

                mapped.top =
                        Math.max(
                                dp(3),
                                mapped.top
                        );

                mapped.right =
                        Math.min(
                                cameraWidth - dp(3),
                                mapped.right
                        );

                mapped.bottom =
                        Math.min(
                                cameraHeight - dp(3),
                                mapped.bottom
                        );

                int baseColor =
                        getObjectColor(
                                object.label
                        );

                int fillColor =
                        Color.argb(
                                48,
                                Color.red(baseColor),
                                Color.green(baseColor),
                                Color.blue(baseColor)
                        );

                int outlineColor =
                        Color.rgb(
                                Color.red(baseColor),
                                Color.green(baseColor),
                                Color.blue(baseColor)
                        );

                fillPaint.setColor(fillColor);
                outlinePaint.setColor(outlineColor);
                outlinePaint.setStrokeWidth(dp(2.5f));

                canvas.drawRoundRect(
                        mapped,
                        dp(12),
                        dp(12),
                        fillPaint
                );

                canvas.drawRoundRect(
                        mapped,
                        dp(12),
                        dp(12),
                        outlinePaint
                );

                drawCornerBrackets(
                        canvas,
                        mapped,
                        outlineColor
                );

                drawObjectLabel(
                        canvas,
                        mapped,
                        object,
                        baseColor
                );
            }
        }

        private void drawCornerBrackets(
                Canvas canvas,
                RectF rect,
                int color
        ) {

            Paint bracketPaint =
                    new Paint(Paint.ANTI_ALIAS_FLAG);

            bracketPaint.setColor(color);
            bracketPaint.setStyle(Paint.Style.STROKE);
            bracketPaint.setStrokeWidth(dp(3.5f));
            bracketPaint.setStrokeCap(Paint.Cap.ROUND);

            float length = dp(15);

            canvas.drawLine(
                    rect.left,
                    rect.top + length,
                    rect.left,
                    rect.top,
                    bracketPaint
            );

            canvas.drawLine(
                    rect.left,
                    rect.top,
                    rect.left + length,
                    rect.top,
                    bracketPaint
            );

            canvas.drawLine(
                    rect.right - length,
                    rect.top,
                    rect.right,
                    rect.top,
                    bracketPaint
            );

            canvas.drawLine(
                    rect.right,
                    rect.top,
                    rect.right,
                    rect.top + length,
                    bracketPaint
            );

            canvas.drawLine(
                    rect.left,
                    rect.bottom - length,
                    rect.left,
                    rect.bottom,
                    bracketPaint
            );

            canvas.drawLine(
                    rect.left,
                    rect.bottom,
                    rect.left + length,
                    rect.bottom,
                    bracketPaint
            );

            canvas.drawLine(
                    rect.right - length,
                    rect.bottom,
                    rect.right,
                    rect.bottom,
                    bracketPaint
            );

            canvas.drawLine(
                    rect.right,
                    rect.bottom - length,
                    rect.right,
                    rect.bottom,
                    bracketPaint
            );
        }

        private void drawObjectLabel(
                Canvas canvas,
                RectF mapped,
                OverlayObject object,
                int color
        ) {

            String confidence =
                    Math.round(
                            object.confidence * 100
                    ) + "%";

            String label =
                    object.label.toUpperCase(Locale.US) +
                    "  " +
                    confidence;

            labelTextPaint.setTextSize(dp(12));

            float textWidth =
                    labelTextPaint.measureText(label);

            float labelHeight = dp(30);
            float labelWidth = textWidth + dp(24);

            float labelLeft = mapped.left;

            if (
                    labelLeft + labelWidth >
                    cameraWidth - dp(8)
            ) {

                labelLeft =
                        cameraWidth -
                        labelWidth -
                        dp(8);
            }

            float labelTop;

            if (
                    mapped.top >
                    labelHeight + dp(10)
            ) {

                labelTop =
                        mapped.top -
                        labelHeight -
                        dp(7);

            } else {

                labelTop =
                        mapped.bottom +
                        dp(7);
            }

            if (
                    labelTop + labelHeight >
                    cameraHeight - dp(8)
            ) {

                labelTop =
                        cameraHeight -
                        labelHeight -
                        dp(8);
            }

            RectF labelRect =
                    new RectF(
                            labelLeft,
                            labelTop,
                            labelLeft + labelWidth,
                            labelTop + labelHeight
                    );

            labelPaint.setColor(
                    Color.argb(
                            225,
                            Color.red(color),
                            Color.green(color),
                            Color.blue(color)
                    )
            );

            canvas.drawRoundRect(
                    labelRect,
                    dp(9),
                    dp(9),
                    labelPaint
            );

            labelTextPaint.setColor(Color.WHITE);

            Paint.FontMetrics metrics =
                    labelTextPaint.getFontMetrics();

            float baseline =
                    labelRect.centerY() -
                    (
                            metrics.ascent +
                            metrics.descent
                    ) / 2f;

            canvas.drawText(
                    label,
                    labelRect.left + dp(12),
                    baseline,
                    labelTextPaint
            );
        }

        private void drawScanningLine(Canvas canvas) {

            if (!animationRunning) {
                return;
            }

            int topHud =
                    dp(14) + dp(64);

            int bottomHud =
                    cameraHeight - dp(74);

            if (bottomHud <= topHud) {
                return;
            }

            float y =
                    topHud +
                    (
                            scanPosition %
                            (
                                    bottomHud - topHud
                            )
                    );

            RectF scanRect =
                    new RectF(
                            dp(12),
                            y,
                            cameraWidth - dp(12),
                            y + dp(2)
                    );

            canvas.drawRoundRect(
                    scanRect,
                    dp(2),
                    dp(2),
                    scanPaint
            );
        }

        private void drawBottomHud(Canvas canvas) {

            int margin = dp(14);

            int bottom =
                    cameraHeight - dp(14);

            int hudHeight = dp(54);

            RectF hud =
                    new RectF(
                            margin,
                            bottom - hudHeight,
                            cameraWidth - margin,
                            bottom
                    );

            hudBackgroundPaint.setColor(
                    Color.argb(
                            180,
                            4,
                            12,
                            10
                    )
            );

            canvas.drawRoundRect(
                    hud,
                    dp(17),
                    dp(17),
                    hudBackgroundPaint
            );

            dotPaint.setColor(
                    Color.rgb(
                            52,
                            211,
                            153
                    )
            );

            canvas.drawCircle(
                    hud.left + dp(19),
                    hud.centerY(),
                    dp(5),
                    dotPaint
            );

            hudTextPaint.setTextSize(dp(12));

            hudTextPaint.setTypeface(
                    Typeface.create(
                            Typeface.DEFAULT,
                            Typeface.BOLD
                    )
            );

            canvas.drawText(
                    objects.isEmpty()
                            ? "SCANNING YOUR SURROUNDINGS..."
                            : "AI ANALYZING OBJECTS",
                    hud.left + dp(32),
                    hud.centerY() + dp(4),
                    hudTextPaint
            );

            Paint modePaint =
                    new Paint(Paint.ANTI_ALIAS_FLAG);

            modePaint.setColor(
                    Color.argb(
                            225,
                            16,
                            185,
                            129
                    )
            );

            String mode = "AR MODE";

            modePaint.setTextSize(dp(9));

            modePaint.setTypeface(
                    Typeface.create(
                            Typeface.DEFAULT,
                            Typeface.BOLD
                    )
            );

            float modeWidth =
                    modePaint.measureText(mode);

            RectF modeRect =
                    new RectF(
                            hud.right -
                                    modeWidth -
                                    dp(30),
                            hud.top + dp(12),
                            hud.right - dp(10),
                            hud.bottom - dp(12)
                    );

            canvas.drawRoundRect(
                    modeRect,
                    dp(10),
                    dp(10),
                    modePaint
            );

            modePaint.setColor(Color.WHITE);

            canvas.drawText(
                    mode,
                    modeRect.left + dp(10),
                    modeRect.centerY() + dp(3),
                    modePaint
            );
        }

        private int getObjectColor(String label) {

            if (label == null) {
                return Color.rgb(
                        52,
                        211,
                        153
                );
            }

            String value =
                    label.toLowerCase(Locale.US);

            if (value.contains("person")) {
                return Color.rgb(
                        56,
                        189,
                        248
                );
            }

            if (
                    value.contains("chair") ||
                    value.contains("couch") ||
                    value.contains("sofa")
            ) {

                return Color.rgb(
                        168,
                        85,
                        247
                );
            }

            if (
                    value.contains("table") ||
                    value.contains("desk")
            ) {

                return Color.rgb(
                        251,
                        146,
                        60
                );
            }

            if (
                    value.contains("bottle") ||
                    value.contains("cup") ||
                    value.contains("glass")
            ) {

                return Color.rgb(
                        45,
                        212,
                        191
                );
            }

            if (
                    value.contains("laptop") ||
                    value.contains("computer") ||
                    value.contains("keyboard") ||
                    value.contains("phone")
            ) {

                return Color.rgb(
                        99,
                        102,
                        241
                );
            }

            if (
                    value.contains("book") ||
                    value.contains("paper")
            ) {

                return Color.rgb(
                        250,
                        204,
                        21
                );
            }

            if (
                    value.contains("tv") ||
                    value.contains("monitor")
            ) {

                return Color.rgb(
                        244,
                        63,
                        94
                );
            }

            return Color.rgb(
                    52,
                    211,
                    153
            );
        }

        private RectF mapBoundingBox(
                OverlayObject object,
                float scale,
                float cropX,
                float cropY
        ) {

            float left = object.left;
            float top = object.top;

            float right =
                    object.left + object.width;

            float bottom =
                    object.top + object.height;

            float rotatedLeft;
            float rotatedTop;
            float rotatedRight;
            float rotatedBottom;

            if (rotation == 90) {

                rotatedLeft =
                        imageHeight - bottom;

                rotatedTop = left;

                rotatedRight =
                        imageHeight - top;

                rotatedBottom = right;

            } else if (rotation == 270) {

                rotatedLeft = top;

                rotatedTop =
                        imageWidth - right;

                rotatedRight = bottom;

                rotatedBottom =
                        imageWidth - left;

            } else if (rotation == 180) {

                rotatedLeft =
                        imageWidth - right;

                rotatedTop =
                        imageHeight - bottom;

                rotatedRight =
                        imageWidth - left;

                rotatedBottom =
                        imageHeight - top;

            } else {

                rotatedLeft = left;
                rotatedTop = top;
                rotatedRight = right;
                rotatedBottom = bottom;
            }

            return new RectF(
                    rotatedLeft * scale - cropX,
                    rotatedTop * scale - cropY,
                    rotatedRight * scale - cropX,
                    rotatedBottom * scale - cropY
            );
        }
    }
}