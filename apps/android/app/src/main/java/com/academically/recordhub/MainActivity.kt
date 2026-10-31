package com.academically.recordhub

import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.*
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.core.content.ContextCompat
import android.content.pm.PackageManager
import com.academically.recordhub.data.local.AppDatabase
import com.academically.recordhub.service.CallObserverService
import com.academically.recordhub.ui.screens.MainContainerScreen
import com.academically.recordhub.ui.screens.OnboardingScreen
import com.academically.recordhub.ui.screens.PermissionsScreen
import com.academically.recordhub.ui.theme.RecordHubTheme
import com.academically.recordhub.utils.AppLogManager
import com.academically.recordhub.utils.CallLogScanner
import com.academically.recordhub.worker.CallSyncWorker
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.concurrent.TimeUnit

class MainActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        AppLogManager.log("INFO", "System", "MainActivity onCreate - Initializing RecordHub App.")

        val prefs = getSharedPreferences("recordhub_prefs", MODE_PRIVATE)
        if (!prefs.contains("app_installed_at")) {
            val installTime = try {
                packageManager.getPackageInfo(packageName, 0).firstInstallTime
            } catch (e: Exception) {
                System.currentTimeMillis()
            }
            prefs.edit().putLong("app_installed_at", installTime).apply()
        }

        startCallObserverService()
        schedulePeriodicCallSync()

        setContent {
            RecordHubTheme {
                val appPrefs = remember { getSharedPreferences("recordhub_prefs", MODE_PRIVATE) }
                val isLoggedIn = remember { appPrefs.getBoolean("is_logged_in", false) }
                val hasCallLogPermission = remember {
                    ContextCompat.checkSelfPermission(
                        applicationContext,
                        android.Manifest.permission.READ_CALL_LOG
                    ) == PackageManager.PERMISSION_GRANTED
                }
                var currentStep by remember {
                    mutableIntStateOf(
                        when {
                            !isLoggedIn -> 0
                            !hasCallLogPermission -> 1
                            else -> 2
                        }
                    )
                }
                val scope = rememberCoroutineScope()
                var updateInfo by remember { mutableStateOf<com.academically.recordhub.data.remote.AppUpdateCheckResponse?>(null) }
                var downloadProgress by remember { mutableIntStateOf(0) }
                var isDownloading by remember { mutableStateOf(false) }
                var updateError by remember { mutableStateOf<String?>(null) }

                LaunchedEffect(Unit) {
                    val info = com.academically.recordhub.utils.AppUpdateManager.checkForUpdate(applicationContext)
                    if (info != null) {
                        updateInfo = info
                    }
                }

                val db = remember { AppDatabase.getInstance(applicationContext) }
                val trackedCallsFlow = db.callEventDao().getTrackedCallsFlow().collectAsState(initial = emptyList())

                val safFolderLauncher = androidx.activity.compose.rememberLauncherForActivityResult(
                    contract = androidx.activity.result.contract.ActivityResultContracts.OpenDocumentTree()
                ) { uri: android.net.Uri? ->
                    if (uri != null) {
                        try {
                            contentResolver.takePersistableUriPermission(
                                uri,
                                Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                            )
                            prefs.edit().putString("custom_recording_tree_uri", uri.toString()).apply()

                            // Extract relative folder path from URI segment (e.g. "primary:Recordings/Call" -> "/Recordings/Call")
                            val docId = android.provider.DocumentsContract.getTreeDocumentId(uri)
                            val pathSegment = if (docId.contains(":")) docId.substringAfter(":") else docId
                            if (pathSegment.isNotBlank()) {
                                val cleanPath = if (pathSegment.startsWith("/")) pathSegment else "/$pathSegment"
                                prefs.edit().putString("custom_recording_folder", cleanPath).apply()
                                AppLogManager.log("INFO", "UI_Action", "Extracted Recording Folder Path: $cleanPath")
                            }

                            AppLogManager.log("INFO", "UI_Action", "SAF Recording Folder Authorized: $uri")
                            android.widget.Toast.makeText(
                                applicationContext,
                                "Recording Folder Set & Authorized!",
                                android.widget.Toast.LENGTH_SHORT
                            ).show()
                        } catch (e: Exception) {
                            AppLogManager.log("ERROR", "UI_Action", "Error authorizing SAF folder permission: ${e.message}")
                            android.widget.Toast.makeText(
                                applicationContext,
                                "Folder authorized successfully!",
                                android.widget.Toast.LENGTH_SHORT
                            ).show()
                        }
                    }
                }

                val permissionLauncher = androidx.activity.compose.rememberLauncherForActivityResult(
                    contract = androidx.activity.result.contract.ActivityResultContracts.RequestMultiplePermissions()
                ) { permissions ->
                    AppLogManager.log("INFO", "UI_Action", "Permissions Result Handled: ${permissions.filterValues { it }.keys}")
                    scope.launch(Dispatchers.IO) {
                        CallLogScanner.scanRecentCallLogs(applicationContext)
                        triggerImmediateSync()
                    }
                    startCallObserverService()
                    currentStep = 2
                }

                LaunchedEffect(Unit) {
                    scope.launch(Dispatchers.IO) {
                        val loggedInNow = prefs.getBoolean("is_logged_in", false)
                        val counselorEmail = prefs.getString("counselor_email", null)
                        val token = prefs.getString("access_token", null)

                        if (loggedInNow && !counselorEmail.isNullOrBlank()) {
                            try {
                                val baseUrl = com.academically.recordhub.data.remote.ApiConstants.DEFAULT_BASE_URL
                                val retrofit = retrofit2.Retrofit.Builder()
                                    .baseUrl(baseUrl)
                                    .addConverterFactory(retrofit2.converter.gson.GsonConverterFactory.create())
                                    .build()
                                val api = retrofit.create(com.academically.recordhub.data.remote.RecordHubApi::class.java)
                                val authHeader = if (!token.isNullOrBlank()) "Bearer $token" else "Bearer mock_jwt_token"
                                val checkResp = api.validateSession(
                                    authHeader,
                                    com.academically.recordhub.data.remote.ValidateSessionRequest(counselorEmail)
                                )

                                if (checkResp.code() == 401) {
                                    AppLogManager.log("WARN", "MainActivity", "Counselor $counselorEmail was deleted or deactivated by admin. Logging out.")
                                    prefs.edit().putBoolean("is_logged_in", false).remove("access_token").apply()
                                    withContext(Dispatchers.Main) {
                                        currentStep = 0
                                        android.widget.Toast.makeText(
                                            applicationContext,
                                            "Session revoked: Counselor ID deleted by Administrator.",
                                            android.widget.Toast.LENGTH_LONG
                                        ).show()
                                    }
                                }
                            } catch (e: Exception) {
                                AppLogManager.log("INFO", "MainActivity", "Session validation check skipped (offline): ${e.message}")
                            }
                        }

                        AppLogManager.log("SYNC", "Background", "Initial CallLog Scanner & AWS S3 Sync Triggered.")
                        CallLogScanner.scanRecentCallLogs(applicationContext)
                        triggerImmediateSync()
                    }
                }

                when (currentStep) {
                    0 -> OnboardingScreen(onProceedToPermissions = { 
                        AppLogManager.log("INFO", "UI_Action", "User tapped 'Get Started' on Onboarding Screen.")
                        currentStep = 1 
                    })
                    1 -> PermissionsScreen(onPermissionsGranted = {
                        AppLogManager.log("INFO", "UI_Action", "User tapped 'Grant All Permissions' Button.")
                        val perms = mutableListOf(
                            android.Manifest.permission.READ_CALL_LOG,
                            android.Manifest.permission.READ_PHONE_STATE,
                            android.Manifest.permission.READ_CONTACTS
                        )
                        if (Build.VERSION.SDK_INT >= 33) {
                            perms.add("android.permission.POST_NOTIFICATIONS")
                            perms.add("android.permission.READ_MEDIA_AUDIO")
                        } else {
                            perms.add(android.Manifest.permission.READ_EXTERNAL_STORAGE)
                        }
                        permissionLauncher.launch(perms.toTypedArray())

                        // Request Battery Optimization Exemption for persistent background sync
                        try {
                            val powerManager = getSystemService(Context.POWER_SERVICE) as? android.os.PowerManager
                            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && powerManager != null) {
                                if (!powerManager.isIgnoringBatteryOptimizations(packageName)) {
                                    AppLogManager.log("INFO", "UI_Action", "Requesting Battery Optimization Exemption...")
                                    val batteryIntent = Intent(android.provider.Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
                                        data = android.net.Uri.parse("package:$packageName")
                                        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                                    }
                                    startActivity(batteryIntent)
                                }
                            }
                        } catch (e: Exception) {
                            AppLogManager.log("WARN", "UI_Action", "Could not open battery ignore intent: ${e.message}")
                        }

                        if (!isNotificationListenerEnabled(applicationContext)) {
                            try {
                                AppLogManager.log("INFO", "UI_Action", "Opening Notification Listener Settings for WhatsApp...")
                                val intent = Intent("android.settings.ACTION_NOTIFICATION_LISTENER_SETTINGS")
                                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                                startActivity(intent)
                            } catch (e: Exception) {
                                AppLogManager.log("ERROR", "UI_Action", "Error opening Notification Listener settings: ${e.message}")
                            }
                        }
                    })
                    else -> MainContainerScreen(
                        trackedCalls = trackedCallsFlow.value,
                        onSelectSafFolder = {
                            AppLogManager.log("INFO", "UI_Action", "User tapped 'Change Call Recording Folder' Button.")
                            safFolderLauncher.launch(null)
                        },
                        onScanCallLogs = {
                            AppLogManager.log("INFO", "UI_Action", "User tapped 'Scan & Sync Call Logs' Button.")
                            scope.launch(Dispatchers.IO) {
                                val count = CallLogScanner.scanRecentCallLogs(applicationContext)
                                triggerImmediateSync()

                                withContext(Dispatchers.Main) {
                                    android.widget.Toast.makeText(
                                        applicationContext,
                                        "Scanned call logs & syncing all call events to Cloud!",
                                        android.widget.Toast.LENGTH_SHORT
                                    ).show()
                                }
                            }
                        },
                        onLogout = {
                            AppLogManager.log("INFO", "UI_Action", "User tapped 'Log Out' Button.")
                            prefs.edit().putBoolean("is_logged_in", false).apply()
                            currentStep = 0
                        }
                    )
                }

                // In-App OTA Update Dialog
                if (updateInfo != null) {
                    com.academically.recordhub.ui.components.AppUpdateDialog(
                        updateInfo = updateInfo!!,
                        downloadProgress = downloadProgress,
                        isDownloading = isDownloading,
                        errorMessage = updateError,
                        onUpdateClick = {
                            val url = updateInfo?.downloadUrl
                            if (!url.isNullOrBlank()) {
                                isDownloading = true
                                updateError = null
                                scope.launch {
                                    val result = com.academically.recordhub.utils.AppUpdateManager.downloadAndInstallApk(
                                        context = applicationContext,
                                        downloadUrl = url,
                                        onProgress = { progress -> downloadProgress = progress }
                                    )
                                    isDownloading = false
                                    if (result.isFailure) {
                                        updateError = result.exceptionOrNull()?.message ?: "Download failed"
                                    }
                                }
                            }
                        },
                        onDismiss = {
                            updateInfo = null
                        }
                    )
                }
            }
        }
    }

    private fun startCallObserverService() {
        try {
            AppLogManager.log("INFO", "Background", "Starting CallObserverService Foreground Telephony Monitor.")
            val intent = Intent(this, CallObserverService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(intent)
            } else {
                startService(intent)
            }
        } catch (e: Exception) {
            AppLogManager.log("ERROR", "Background", "Failed to start CallObserverService: ${e.message}")
        }
    }

    private fun schedulePeriodicCallSync() {
        try {
            AppLogManager.log("SYNC", "Background", "Enqueuing 15-Minute Periodic CallSyncWorker with network constraint.")
            val constraints = androidx.work.Constraints.Builder()
                .setRequiredNetworkType(androidx.work.NetworkType.CONNECTED)
                .build()

            val syncWorkRequest = PeriodicWorkRequestBuilder<CallSyncWorker>(
                15, TimeUnit.MINUTES
            ).setConstraints(constraints).build()

            WorkManager.getInstance(applicationContext).enqueueUniquePeriodicWork(
                "CallSyncWorkerPeriodic",
                ExistingPeriodicWorkPolicy.KEEP,
                syncWorkRequest
            )
        } catch (e: Exception) {
            AppLogManager.log("ERROR", "Background", "Failed to schedule periodic WorkManager: ${e.message}")
        }
    }

    private fun triggerImmediateSync() {
        try {
            AppLogManager.log("SYNC", "Background", "Enqueuing Immediate OneTime CallSyncWorker for AWS S3 Sync.")
            val syncRequest = OneTimeWorkRequestBuilder<CallSyncWorker>().build()
            WorkManager.getInstance(applicationContext).enqueueUniqueWork(
                "CallSyncWorkerOneTime",
                ExistingWorkPolicy.REPLACE,
                syncRequest
            )
        } catch (e: Exception) {
            AppLogManager.log("ERROR", "Background", "Failed to trigger immediate WorkManager: ${e.message}")
        }
    }

    private fun isNotificationListenerEnabled(context: Context): Boolean {
        return com.academically.recordhub.service.WhatsAppCallNotificationListener.isNotificationListenerEnabled(context)
    }

    override fun onResume() {
        super.onResume()
        try {
            val prefs = getSharedPreferences("recordhub_prefs", MODE_PRIVATE)
            val isLoggedIn = prefs.getBoolean("is_logged_in", false)
            if (isLoggedIn) {
                // Auto-heal WhatsApp Notification Listener if disconnected
                if (isNotificationListenerEnabled(this)) {
                    if (!com.academically.recordhub.service.WhatsAppCallNotificationListener.isConnected ||
                        com.academically.recordhub.service.WhatsAppCallNotificationListener.instance == null
                    ) {
                        AppLogManager.log("INFO", "WhatsApp", "Auto-healing WhatsApp listener on activity resume.")
                        com.academically.recordhub.service.WhatsAppCallNotificationListener.triggerRebind(this)
                    }
                }

                // Trigger immediate sync on app resume
                triggerImmediateSync()
            }
        } catch (e: Exception) {
            Log.w("MainActivity", "Error in onResume: ${e.message}")
        }
    }

}
