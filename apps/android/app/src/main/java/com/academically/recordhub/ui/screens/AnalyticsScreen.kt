package com.academically.recordhub.ui.screens

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.academically.recordhub.data.local.CallEventEntity
import java.text.SimpleDateFormat
import java.util.*

private val ScreenBg = Color(0xFFFAFAFA)
private val HeaderBarBg = Color(0xFFE2E8F0)
private val CardBg = Color(0xFFFFFFFF)
private val TextPrimary = Color(0xFF1A1F2C)
private val TextSecondary = Color(0xFF64748B)
private val AmberGold = Color(0xFFFAB005)
private val WhatsAppColor = Color(0xFF25D366)
private val CardBorderColor = Color(0xFFE2E8F0)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AnalyticsScreen(
    callEvents: List<CallEventEntity>
) {
    var selectedRange by remember { mutableStateOf("Today") }
    var showBottomSheet by remember { mutableStateOf(false) }
    var selectedSimFilter by remember { mutableStateOf("ALL") }

    val (startTimestamp, endTimestamp, formattedRangeString) = remember(selectedRange) {
        val cal = Calendar.getInstance()
        val now = System.currentTimeMillis()
        val sdf = SimpleDateFormat("dd-MMM hh:mm a", Locale.getDefault())

        when (selectedRange) {
            "Today" -> {
                cal.set(Calendar.HOUR_OF_DAY, 0)
                cal.set(Calendar.MINUTE, 0)
                cal.set(Calendar.SECOND, 0)
                val start = cal.timeInMillis
                cal.set(Calendar.HOUR_OF_DAY, 23)
                cal.set(Calendar.MINUTE, 59)
                cal.set(Calendar.SECOND, 59)
                val end = cal.timeInMillis
                Triple(start, end, "${sdf.format(Date(start))} - ${sdf.format(Date(end))}")
            }
            "Yesterday" -> {
                cal.add(Calendar.DAY_OF_YEAR, -1)
                cal.set(Calendar.HOUR_OF_DAY, 0)
                cal.set(Calendar.MINUTE, 0)
                val start = cal.timeInMillis
                cal.set(Calendar.HOUR_OF_DAY, 23)
                cal.set(Calendar.MINUTE, 59)
                val end = cal.timeInMillis
                Triple(start, end, "${sdf.format(Date(start))} - ${sdf.format(Date(end))}")
            }
            "Week" -> {
                cal.add(Calendar.DAY_OF_YEAR, -7)
                val start = cal.timeInMillis
                Triple(start, now, "${sdf.format(Date(start))} - ${sdf.format(Date(now))}")
            }
            "Month" -> {
                cal.add(Calendar.DAY_OF_YEAR, -30)
                val start = cal.timeInMillis
                Triple(start, now, "${sdf.format(Date(start))} - ${sdf.format(Date(now))}")
            }
            "Year" -> {
                cal.add(Calendar.YEAR, -1)
                val start = cal.timeInMillis
                Triple(start, now, "${sdf.format(Date(start))} - ${sdf.format(Date(now))}")
            }
            else -> {
                Triple(0L, Long.MAX_VALUE, "All Recorded Call History")
            }
        }
    }

    val rangeCalls = remember(callEvents, startTimestamp, endTimestamp, selectedSimFilter) {
        callEvents.filter { call ->
            val inTime = call.startTime in startTimestamp..endTimestamp
            val inSim = when (selectedSimFilter) {
                "SIM1" -> !call.isWhatsAppCall() && call.simSlot == 0
                "SIM2" -> !call.isWhatsAppCall() && call.simSlot == 1
                else -> true
            }
            inTime && inSim
        }
    }

    val totalCalls = rangeCalls.size
    val whatsAppCalls = rangeCalls.count { it.isWhatsAppCall() }
    val sim1Count = rangeCalls.count { !it.isWhatsAppCall() && it.simSlot == 0 }
    val sim2Count = rangeCalls.count { !it.isWhatsAppCall() && it.simSlot == 1 }
    val incomingCalls = rangeCalls.count { it.direction.equals("INCOMING", ignoreCase = true) }
    val outgoingCalls = rangeCalls.count { it.direction.equals("OUTGOING", ignoreCase = true) }
    val missedCalls = rangeCalls.count { it.status.equals("MISSED", ignoreCase = true) || it.status.equals("REJECTED", ignoreCase = true) }
    val totalDurationSecs = rangeCalls.sumOf { it.durationSeconds.toLong() }
    val avgDurationSecs = if (totalCalls > 0) totalDurationSecs / totalCalls else 0L

    val durationFormatted = remember(totalDurationSecs) {
        val mins = totalDurationSecs / 60
        val secs = totalDurationSecs % 60
        if (mins > 0) "${mins}m ${secs}s" else "${secs}s"
    }

    Scaffold(
        containerColor = ScreenBg
    ) { paddingVals ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingVals)
        ) {
            // 1. Top App Bar: "Analytics" + Multi-Device/SIM Icons
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .statusBarsPadding()
                    .padding(horizontal = 20.dp, vertical = 12.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = "Analytics",
                    fontWeight = FontWeight.Bold,
                    fontSize = 24.sp,
                    color = TextPrimary
                )

                Row(
                    horizontalArrangement = Arrangement.spacedBy(14.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Icon(
                        imageVector = Icons.Default.Layers,
                        contentDescription = "All",
                        tint = if (selectedSimFilter == "ALL") TextPrimary else Color(0xFF94A3B8),
                        modifier = Modifier
                            .size(22.dp)
                            .clickable { selectedSimFilter = "ALL" }
                    )

                    Box(
                        modifier = Modifier
                            .border(1.2.dp, if (selectedSimFilter == "SIM2") TextPrimary else Color(0xFF94A3B8), RoundedCornerShape(4.dp))
                            .clickable { selectedSimFilter = if (selectedSimFilter == "SIM2") "ALL" else "SIM2" }
                            .padding(horizontal = 5.dp, vertical = 1.dp)
                    ) {
                        Text(
                            text = "2",
                            fontSize = 11.sp,
                            fontWeight = FontWeight.Bold,
                            color = if (selectedSimFilter == "SIM2") TextPrimary else Color(0xFF94A3B8)
                        )
                    }

                    Icon(
                        imageVector = Icons.Default.Chat,
                        contentDescription = "WhatsApp",
                        tint = WhatsAppColor,
                        modifier = Modifier.size(20.dp)
                    )
                }
            }

            // 2. Date Range Header Sub-bar
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(HeaderBarBg)
                    .padding(horizontal = 14.dp, vertical = 8.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = formattedRangeString,
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Bold,
                    color = TextPrimary,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f).padding(end = 8.dp)
                )

                Surface(
                    shape = RoundedCornerShape(10.dp),
                    color = CardBg,
                    border = BorderStroke(1.dp, CardBorderColor),
                    modifier = Modifier.clickable { showBottomSheet = true }
                ) {
                    Row(
                        modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(4.dp)
                    ) {
                        Text(
                            text = selectedRange,
                            fontWeight = FontWeight.Bold,
                            fontSize = 12.5.sp,
                            color = TextPrimary,
                            maxLines = 1
                        )
                        Icon(
                            imageVector = Icons.Default.KeyboardArrowDown,
                            contentDescription = "Select Range",
                            tint = TextPrimary,
                            modifier = Modifier.size(16.dp)
                        )
                    }
                }
            }

            // 3. Analytics Content
            if (rangeCalls.isEmpty()) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .weight(1f),
                    contentAlignment = Alignment.Center
                ) {
                    Text(
                        text = "No interaction since",
                        fontSize = 15.sp,
                        color = Color(0xFF64748B),
                        fontWeight = FontWeight.Medium
                    )
                }
            } else {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .weight(1f)
                        .verticalScroll(rememberScrollState())
                        .padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(16.dp)
                ) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(10.dp)
                    ) {
                        AnalyticsCard(title = "Total Calls", value = "$totalCalls", color = AmberGold, modifier = Modifier.weight(1f))
                        AnalyticsCard(title = "Inbound", value = "$incomingCalls", color = Color(0xFF22C55E), modifier = Modifier.weight(1f))
                    }

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(10.dp)
                    ) {
                        AnalyticsCard(title = "Outbound", value = "$outgoingCalls", color = Color(0xFFF97316), modifier = Modifier.weight(1f))
                        AnalyticsCard(title = "Missed", value = "$missedCalls", color = Color(0xFFEF4444), modifier = Modifier.weight(1f))
                    }

                    AnalyticsCard(
                        title = "WhatsApp Calls",
                        value = "$whatsAppCalls",
                        color = WhatsAppColor,
                        modifier = Modifier.fillMaxWidth()
                    )

                    Card(
                        shape = RoundedCornerShape(14.dp),
                        colors = CardDefaults.cardColors(containerColor = CardBg),
                        border = BorderStroke(1.dp, CardBorderColor),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(14.dp),
                            horizontalArrangement = Arrangement.SpaceAround,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Column(
                                horizontalAlignment = Alignment.CenterHorizontally,
                                modifier = Modifier.weight(1f)
                            ) {
                                Text("Total Talk Time", fontSize = 11.5.sp, color = TextSecondary, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                Spacer(modifier = Modifier.height(3.dp))
                                Text(durationFormatted, fontWeight = FontWeight.Bold, fontSize = 16.sp, color = TextPrimary, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            }
                            Divider(
                                modifier = Modifier
                                    .height(36.dp)
                                    .width(1.dp),
                                color = CardBorderColor
                            )
                            Column(
                                horizontalAlignment = Alignment.CenterHorizontally,
                                modifier = Modifier.weight(1f)
                            ) {
                                Text("Avg Call Duration", fontSize = 11.5.sp, color = TextSecondary, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                Spacer(modifier = Modifier.height(3.dp))
                                Text("${avgDurationSecs}s", fontWeight = FontWeight.Bold, fontSize = 16.sp, color = TextPrimary, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            }
                        }
                    }

                    Card(
                        shape = RoundedCornerShape(14.dp),
                        colors = CardDefaults.cardColors(containerColor = CardBg),
                        border = BorderStroke(1.dp, CardBorderColor),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Column(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(14.dp),
                            verticalArrangement = Arrangement.spacedBy(12.dp)
                        ) {
                            Text("Call Channels", fontWeight = FontWeight.Bold, fontSize = 13.5.sp, color = TextPrimary)

                            ChannelProgressRow(label = "SIM Slot 1", count = sim1Count, total = totalCalls, color = Color(0xFF2563EB))
                            ChannelProgressRow(label = "SIM Slot 2", count = sim2Count, total = totalCalls, color = AmberGold)
                            ChannelProgressRow(label = "WhatsApp", count = whatsAppCalls, total = totalCalls, color = WhatsAppColor)
                        }
                    }
                }
            }
        }
    }

    // 4. Date Filter Bottom Sheet
    if (showBottomSheet) {
        ModalBottomSheet(
            onDismissRequest = { showBottomSheet = false },
            sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
            containerColor = Color.White,
            shape = RoundedCornerShape(topStart = 24.dp, topEnd = 24.dp)
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 24.dp, vertical = 12.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                val options = listOf("Today", "Yesterday", "Week", "Month", "Year", "Custom", "All Time")

                options.forEach { option ->
                    val isSelected = selectedRange == option
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable {
                                selectedRange = option
                                showBottomSheet = false
                            }
                            .padding(vertical = 10.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        if (isSelected) {
                            Icon(
                                imageVector = Icons.Default.Check,
                                contentDescription = "Selected",
                                tint = AmberGold,
                                modifier = Modifier.size(20.dp)
                            )
                            Spacer(modifier = Modifier.width(12.dp))
                        } else {
                            Spacer(modifier = Modifier.width(32.dp))
                        }

                        Text(
                            text = option,
                            fontSize = 16.sp,
                            fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Normal,
                            color = TextPrimary
                        )
                    }
                }

                Spacer(modifier = Modifier.height(20.dp))
            }
        }
    }
}

private fun CallEventEntity.isWhatsAppCall(): Boolean =
    disposition.contains("WhatsApp", ignoreCase = true) ||
        idempotencyKey.startsWith("WA_", ignoreCase = true) ||
        idempotencyKey.startsWith("WA_LOG-", ignoreCase = true)

@Composable
private fun AnalyticsCard(title: String, value: String, color: Color, modifier: Modifier = Modifier) {
    Card(
        shape = RoundedCornerShape(14.dp),
        colors = CardDefaults.cardColors(containerColor = CardBg),
        border = BorderStroke(1.dp, CardBorderColor),
        modifier = modifier
    ) {
        Column(
            modifier = Modifier.padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(3.dp)
        ) {
            Text(
                text = title, 
                fontSize = 11.5.sp, 
                color = TextSecondary,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
            Text(
                text = value, 
                fontSize = 19.sp, 
                fontWeight = FontWeight.Bold, 
                color = color,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
        }
    }
}

@Composable
private fun ChannelProgressRow(label: String, count: Int, total: Int, color: Color) {
    val fraction = if (total > 0) count.toFloat() / total.toFloat() else 0f
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Text(label, fontSize = 12.sp, color = TextPrimary, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text("$count (${(fraction * 100).toInt()}%)", fontSize = 11.5.sp, color = TextSecondary, maxLines = 1)
        }
        LinearProgressIndicator(
            progress = { fraction },
            modifier = Modifier
                .fillMaxWidth()
                .height(6.dp)
                .clip(RoundedCornerShape(3.dp)),
            color = color,
            trackColor = Color(0xFFF1F5F9)
        )
    }
}
