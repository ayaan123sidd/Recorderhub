package com.academically.recordhub.service

import android.app.Notification
import android.content.ComponentName
import android.content.Context
import android.os.Build
import android.provider.Settings
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.util.Log
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import com.academically.recordhub.data.local.AppDatabase
import com.academically.recordhub.data.local.CallEventEntity
import com.academically.recordhub.utils.AppLogManager
import com.academically.recordhub.worker.CallSyncWorker
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import java.io.File

class WhatsAppCallNotificationListener : NotificationListenerService() {
    private var isCallActive: Boolean = false
    private var activeCallNotificationKey: String? = null
    private var activeCallNotificationId: Int = -1
    private var callStartTimeMs: Long = 0
    private var currentContactTitle: String = "WhatsApp Contact"
    private var currentCallDirection: String = "OUTGOING"

    override fun onCreate() {
        super.onCreate()
        instance = this
        AppLogManager.log("INFO", "WhatsAppListener", "WhatsApp NotificationListenerService Initialized (Call Logs Active).")
    }

    override fun onListenerConnected() {
        super.onListenerConnected()
        isConnected = true
        instance = this
        AppLogManager.log("INFO", "WhatsAppListener", "NotificationListenerService Connected to OS successfully!")
        scanActiveWhatsAppNotifications()
    }

    override fun onListenerDisconnected() {
        super.onListenerDisconnected()
        isConnected = false
        AppLogManager.log("WARN", "WhatsAppListener", "NotificationListenerService Disconnected. Requesting rebind...")
        triggerRebind(applicationContext)
    }

    override fun onDestroy() {
        super.onDestroy()
        isConnected = false
        instance = null
        AppLogManager.log("INFO", "WhatsAppListener", "WhatsApp NotificationListenerService Destroyed.")
    }

    private fun scanActiveWhatsAppNotifications() {
        try {
            val activeNotifs = activeNotifications ?: return
            for (sbn in activeNotifs) {
                processNotificationPosted(sbn)
            }
        } catch (e: Exception) {
            AppLogManager.log("ERROR", "WhatsAppListener", "Error scanning active notifications: ${e.message}")
        }
    }

    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        sbn ?: return
        processNotificationPosted(sbn)
    }

    private fun processNotificationPosted(sbn: StatusBarNotification) {
        val packageName = sbn.packageName ?: ""

        if (!isWhatsAppPackage(packageName)) return

        val notification = sbn.notification ?: return
        val extras = notification.extras ?: android.os.Bundle()

        val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString()
            ?: extras.getCharSequence("android.title")?.toString() ?: ""

        val text = extras.getCharSequence(Notification.EXTRA_TEXT)?.toString()
            ?: extras.getCharSequence("android.text")?.toString() ?: ""

        val subText = extras.getCharSequence(Notification.EXTRA_SUB_TEXT)?.toString() ?: ""
        val category = notification.category ?: ""
        val tag = sbn.tag ?: ""
        val template = extras.getString(Notification.EXTRA_TEMPLATE) ?: ""

        val combinedStr = "$title $text $subText $category $tag $template".lowercase()
        val isOngoing = (notification.flags and Notification.FLAG_ONGOING_EVENT) != 0 ||
                (notification.flags and Notification.FLAG_FOREGROUND_SERVICE) != 0 ||
                (notification.flags and Notification.FLAG_NO_CLEAR) != 0

        // 0. Strict exclusion of all text chats, group chats, mentions, and media notifications
        val isTextMessageTemplate = template.contains("MessagingStyle", ignoreCase = true) ||
                template.contains("BigTextStyle", ignoreCase = true) ||
                template.contains("InboxStyle", ignoreCase = true) ||
                template.contains("BigPictureStyle", ignoreCase = true)

        val hasTextMessagePhrase = combinedStr.contains("mentioned you") ||
                combinedStr.contains("mention") ||
                combinedStr.contains("group:") ||
                combinedStr.contains("added you") ||
                combinedStr.contains("messages") ||
                combinedStr.contains("unread") ||
                combinedStr.contains("reply") ||
                combinedStr.contains("संदेश") ||
                combinedStr.contains("photo") ||
                combinedStr.contains("sticker") ||
                combinedStr.contains("gif") ||
                combinedStr.contains("document") ||
                combinedStr.contains("pinned") ||
                combinedStr.contains("reacted") ||
                title.contains("messages)", ignoreCase = true)

        // Only ongoing notifications with non-text templates can be live phone calls
        if (isTextMessageTemplate || hasTextMessagePhrase || !isOngoing) {
            return
        }

        val actions = notification.actions
        val hasCallActions = actions != null && actions.isNotEmpty() && actions.any { action ->
            val actionTitle = action.title?.toString()?.lowercase() ?: ""
            actionTitle.contains("decline") || actionTitle.contains("answer") || actionTitle.contains("hang up") ||
            actionTitle.contains("mute") || actionTitle.contains("speaker") || actionTitle.contains("end call") ||
            actionTitle.contains("reject") || actionTitle.contains("accept") || actionTitle.contains("dismiss") ||
            actionTitle.contains("अस्वीकार") || actionTitle.contains("उत्तर") || actionTitle.contains("समाप्त") ||
            actionTitle.contains("जवाब") || actionTitle.contains("কল") || actionTitle.contains("رد") || actionTitle.contains("رفض")
        }

        val isCallStyle = template.contains("CallStyle", ignoreCase = true)

        val hasExplicitCallPhrase = combinedStr.contains("whatsapp call") ||
                combinedStr.contains("voice call") ||
                combinedStr.contains("video call") ||
                combinedStr.contains("ongoing voice call") ||
                combinedStr.contains("ongoing video call") ||
                combinedStr.contains("ongoing call") ||
                combinedStr.contains("incoming voice call") ||
                combinedStr.contains("incoming video call") ||
                combinedStr.contains("incoming call") ||
                combinedStr.contains("outgoing call") ||
                combinedStr.contains("calling") ||
                combinedStr.contains("ringing") ||
                combinedStr.contains("call in progress") ||
                combinedStr.contains("return to call") ||
                combinedStr.contains("tap to return") ||
                combinedStr.contains("in call") ||
                combinedStr.contains("आवाज कॉल") ||
                combinedStr.contains("वीडियो कॉल") ||
                combinedStr.contains("चल रही कॉल") ||
                combinedStr.contains("इनकमिंग") ||
                combinedStr.contains("आउटगोइंग")

        val isCategoryCall = category == Notification.CATEGORY_CALL ||
                category.contains("call", ignoreCase = true) ||
                category.contains("voip", ignoreCase = true)

        val isCallNotification = isOngoing && (isCallStyle || isCategoryCall || hasCallActions || hasExplicitCallPhrase || tag.contains("call", ignoreCase = true))

        if (isCallNotification) {
            activeCallNotificationKey = sbn.key
            activeCallNotificationId = sbn.id

            if (!isCallActive) {
                isCallActive = true
                callStartTimeMs = System.currentTimeMillis()

                currentCallDirection = if (combinedStr.contains("incoming") || combinedStr.contains("आगमन") || combinedStr.contains("इनकमिंग")) {
                    "INCOMING"
                } else {
                    "OUTGOING"
                }

                // Extract contact name or clean title
                currentContactTitle = cleanContactTitle(title, text)

                AppLogManager.log("INFO", "WhatsAppListener", "Active WhatsApp call DETECTED: $packageName ($currentContactTitle) [$currentCallDirection]")
            }
        }
    }

    private fun cleanContactTitle(rawTitle: String, rawText: String): String {
        val nonGenericTitle = if (rawTitle.isNotBlank() &&
            !rawTitle.equals("WhatsApp", ignoreCase = true) &&
            !rawTitle.equals("WhatsApp Business", ignoreCase = true)
        ) rawTitle else ""

        val candidate = if (nonGenericTitle.isNotBlank()) {
            nonGenericTitle
        } else if (rawText.isNotBlank() && !rawText.contains("call", ignoreCase = true) && !rawText.contains(":")) {
            rawText
        } else {
            "WhatsApp Contact"
        }

        // Clean out common prefix strings like "Incoming voice call • " or "WhatsApp call • "
        var cleaned = PREFIX_INCOMING_REGEX.replace(candidate, "")
        cleaned = PREFIX_OUTGOING_REGEX.replace(cleaned, "")
        cleaned = PREFIX_ONGOING_REGEX.replace(cleaned, "")
        cleaned = PREFIX_WHATSAPP_REGEX.replace(cleaned, "")
        return cleaned.trim().ifBlank { "WhatsApp Contact" }
    }

    override fun onNotificationRemoved(sbn: StatusBarNotification?) {
        sbn ?: return
        val packageName = sbn.packageName ?: ""

        if (isWhatsAppPackage(packageName) && isCallActive) {
            val isTargetNotification = sbn.key == activeCallNotificationKey || 
                                       sbn.id == activeCallNotificationId ||
                                       sbn.notification.category == Notification.CATEGORY_CALL ||
                                       (sbn.tag ?: "").contains("call", ignoreCase = true)

            if (!isTargetNotification) return

            // Debounce: verify if any remaining active notification is still a WhatsApp call before ending call
            val hasOtherCallNotification = try {
                activeNotifications?.any { other ->
                    isWhatsAppPackage(other.packageName ?: "") &&
                    other.key != sbn.key &&
                    (other.notification.category == Notification.CATEGORY_CALL ||
                     (other.tag ?: "").contains("call", ignoreCase = true) ||
                     (other.notification.actions?.any { a -> (a.title?.toString()?.lowercase() ?: "").contains("end") } == true))
                } == true
            } catch (e: Exception) {
                false
            }

            if (!hasOtherCallNotification) {
                AppLogManager.log("INFO", "WhatsAppListener", "WhatsApp call notification REMOVED for $packageName. Finishing call tracking.")
                finishWhatsAppCall()
            }
        }
    }

    private fun finishWhatsAppCall() {
        if (!isCallActive) return
        isCallActive = false

        val durationSec = Math.max(1L, (System.currentTimeMillis() - callStartTimeMs) / 1000)
        AppLogManager.log("INFO", "WhatsAppListener", "WhatsApp call FINISHED. Contact: $currentContactTitle, Duration: ${durationSec}s [$currentCallDirection]")

        saveAndSyncWhatsAppCall(durationSec, currentContactTitle, currentCallDirection)
        activeCallNotificationKey = null
        activeCallNotificationId = -1
    }

    private fun saveAndSyncWhatsAppCall(durationSeconds: Long, contactName: String, direction: String) {
        val context = applicationContext
        val db = AppDatabase.getInstance(context)
        val androidId = Settings.Secure.getString(context.contentResolver, Settings.Secure.ANDROID_ID) ?: "ANDROID_WHATSAPP_DEVICE"
        val deviceId = "ANDROID-${Build.MODEL.replace(" ", "_")}-$androidId"

        // Format phone number preserving country code (+92, +91, +1, etc.) or contact name
        val cleanPhone = com.academically.recordhub.utils.PhoneUtils.formatInternationalNumber(contactName, contactName)

        val randomSuffix = (1000..9999).random()
        val idempotencyKey = "WA_${System.currentTimeMillis()}_${cleanPhone.hashCode()}_$randomSuffix"

        val event = CallEventEntity(
            deviceId = deviceId,
            idempotencyKey = idempotencyKey,
            phoneNumber = cleanPhone,
            direction = direction,
            status = "ANSWERED",
            startTime = callStartTimeMs,
            endTime = System.currentTimeMillis(),
            durationSeconds = durationSeconds.toInt(),
            simSlot = 0,
            isPrivate = false,
            recordingPath = null,
            recordingStatus = "NONE",
            disposition = "WhatsApp Call",
            syncStatus = "PENDING"
        )

        CoroutineScope(Dispatchers.IO).launch {
            try {
                db.callEventDao().insertCallEvent(event)
                AppLogManager.log("SYNC", "WhatsAppListener", "Saved new WhatsApp call to Room DB: $cleanPhone (${durationSeconds}s) [$idempotencyKey]")

                val syncRequest = OneTimeWorkRequestBuilder<CallSyncWorker>().build()
                WorkManager.getInstance(context).enqueueUniqueWork(
                    "CallSyncWorkerOneTime",
                    ExistingWorkPolicy.REPLACE,
                    syncRequest
                )
            } catch (e: Exception) {
                AppLogManager.log("ERROR", "WhatsAppListener", "Failed to save WhatsApp call event: ${e.message}")
            }
        }
    }

    companion object {
        var instance: WhatsAppCallNotificationListener? = null
        var isConnected: Boolean = false

        private val PREFIX_INCOMING_REGEX = Regex("(?i)incoming (voice|video)? ?call:?")
        private val PREFIX_OUTGOING_REGEX = Regex("(?i)outgoing (voice|video)? ?call:?")
        private val PREFIX_ONGOING_REGEX = Regex("(?i)ongoing (voice|video)? ?call:?")
        private val PREFIX_WHATSAPP_REGEX = Regex("(?i)whatsapp (voice|video)? ?call:?")

        fun isWhatsAppPackage(packageName: String): Boolean {
            if (packageName.isBlank()) return false
            return packageName == "com.whatsapp" ||
                    packageName == "com.whatsapp.w4b" ||
                    packageName.startsWith("com.whatsapp") ||
                    packageName == "com.gbwhatsapp" ||
                    packageName == "com.whatsapp.clone" ||
                    packageName == "com.whatsapp.dual" ||
                    packageName == "com.yowhats" ||
                    packageName == "com.fmwhatsapp"
        }

        fun isNotificationListenerEnabled(context: Context): Boolean {
            return try {
                val enabledListeners = Settings.Secure.getString(
                    context.contentResolver,
                    "enabled_notification_listeners"
                ) ?: ""
                val myPkg = context.packageName
                val myComponentName = ComponentName(context, WhatsAppCallNotificationListener::class.java).flattenToString()
                val myShortComponentName = ComponentName(context, WhatsAppCallNotificationListener::class.java).flattenToShortString()

                val isGrantedInSettings = enabledListeners.contains(myComponentName) ||
                        enabledListeners.contains(myShortComponentName) ||
                        enabledListeners.contains(myPkg)

                val isGrantedViaCompat = androidx.core.app.NotificationManagerCompat.getEnabledListenerPackages(context).contains(myPkg)

                isGrantedInSettings || isGrantedViaCompat
            } catch (e: Exception) {
                false
            }
        }

        private var lastRebindAttemptMs: Long = 0

        fun triggerRebind(context: Context) {
            val now = System.currentTimeMillis()
            if (now - lastRebindAttemptMs < 5_000L) {
                return
            }
            lastRebindAttemptMs = now
            try {
                val componentName = ComponentName(context, WhatsAppCallNotificationListener::class.java)

                // 1. Official Android N+ requestRebind
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                    try {
                        requestRebind(componentName)
                        AppLogManager.log("INFO", "WhatsAppListener", "Triggered safe notification listener requestRebind.")
                    } catch (e: Exception) {
                        Log.w("WhatsAppListener", "requestRebind notice: ${e.message}")
                    }
                }

                // 2. Component toggle technique (Forces Android OS NotificationManagerService to immediately reconnect the listener)
                val pm = context.packageManager
                pm.setComponentEnabledSetting(
                    componentName,
                    android.content.pm.PackageManager.COMPONENT_ENABLED_STATE_DISABLED,
                    android.content.pm.PackageManager.DONT_KILL_APP
                )
                pm.setComponentEnabledSetting(
                    componentName,
                    android.content.pm.PackageManager.COMPONENT_ENABLED_STATE_ENABLED,
                    android.content.pm.PackageManager.DONT_KILL_APP
                )
                AppLogManager.log("INFO", "WhatsAppListener", "Notification listener component toggle rebind executed successfully.")
            } catch (e: Exception) {
                AppLogManager.log("WARN", "WhatsAppListener", "Error triggering robust rebind: ${e.message}")
            }
        }
    }
}
