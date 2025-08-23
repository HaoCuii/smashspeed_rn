package com.astrangepotato.yolo

import kotlin.math.sqrt

data class Point(val x: Double, val y: Double)
data class KalmanState(val point: Point, val velocityPixelsPerFrame: Double?)

class KalmanTracker(val scaleFactor: Double) {

    // State vector [x, y, vx, vy]
    private var x = doubleArrayOf(0.0, 0.0, 0.0, 0.0)

    // State covariance matrix P (row-major 4x4)
    // [ p00 p01 p02 p03
    //   p10 p11 p12 p13
    //   p20 p21 p22 p23
    //   p30 p31 p32 p33 ]
    private var p = doubleArrayOf(
        1.0, 0.0, 0.0, 0.0,
        0.0, 1.0, 0.0, 0.0,
        0.0, 0.0, 1000.0, 0.0,
        0.0, 0.0, 0.0, 1000.0
    )

    private val q: Double = 1e-4 // Process noise
    private val r: Double = 0.01 // Measurement noise

    internal var isInitialized = false

    fun predict(dt: Double = 1.0): Point? {
        if (!isInitialized) return null

        // x = F x
        x[0] += dt * x[2]
        x[1] += dt * x[3]

        // P = F P F^T + Q (expanded for constant-velocity model)
        val p00 = p[0] + dt * (p[8] + p[2]) + dt * dt * p[10] + q
        val p01 = p[1] + dt * (p[9] + p[3]) + dt * dt * p[11]
        val p02 = p[2] + dt * p[10]
        val p03 = p[3] + dt * p[11]

        val p10 = p[4] + dt * (p[12] + p[6]) + dt * dt * p[14]
        val p11 = p[5] + dt * (p[13] + p[7]) + dt * dt * p[15] + q
        val p12 = p[6] + dt * p[14]
        val p13 = p[7] + dt * p[15]

        val p20 = p[8] + dt * p[10]
        val p21 = p[9] + dt * p[11]
        val p22 = p[10] + q
        val p23 = p[11]

        val p30 = p[12] + dt * p[14]
        val p31 = p[13] + dt * p[15]
        val p32 = p[14]
        val p33 = p[15] + q

        p = doubleArrayOf(
            p00, p01, p02, p03,
            p10, p11, p12, p13,
            p20, p21, p22, p23,
            p30, p31, p32, p33
        )

        return Point(x[0], x[1])
    }

    fun update(measurement: Point) {
        if (!isInitialized) {
            x[0] = measurement.x
            x[1] = measurement.y
            isInitialized = true
            return
        }

        // Innovation
        val y0 = measurement.x - x[0]
        val y1 = measurement.y - x[1]

        // S = H P H^T + R, with H = [[1,0,0,0],[0,1,0,0]]
        val s00 = p[0] + r       // p00 + r
        val s01 = p[1]           // p01
        val s10 = p[4]           // p10
        val s11 = p[5] + r       // p11 + r

        val detS = s00 * s11 - s01 * s10
        if (detS == 0.0) return

        // S^-1
        val invS00 =  s11 / detS
        val invS01 = -s01 / detS
        val invS10 = -s10 / detS
        val invS11 =  s00 / detS

        // K = P H^T S^-1  (4x2)
        val k00 = p[0]  * invS00 + p[1]  * invS10  // Swift k11
        val k01 = p[0]  * invS01 + p[1]  * invS11  // Swift k12
        val k10 = p[4]  * invS00 + p[5]  * invS10  // Swift k21
        val k11 = p[4]  * invS01 + p[5]  * invS11  // Swift k22
        val k20 = p[8]  * invS00 + p[9]  * invS10  // Swift k31
        val k21 = p[8]  * invS01 + p[9]  * invS11  // Swift k32
        val k30 = p[12] * invS00 + p[13] * invS10  // Swift k41
        val k31 = p[12] * invS01 + p[13] * invS11  // Swift k42

        // x = x + K y
        x[0] += k00 * y0 + k01 * y1
        x[1] += k10 * y0 + k11 * y1
        x[2] += k20 * y0 + k21 * y1
        x[3] += k30 * y0 + k31 * y1

        // (I - K H) P — match Swift: update rows 0 & 1 across all columns
        val i_kh_11 = 1.0 - k00
        val i_kh_12 = -k01
        val i_kh_21 = -k10
        val i_kh_22 = 1.0 - k11

        val p00n = p[0] * i_kh_11 + p[4] * i_kh_12
        val p01n = p[1] * i_kh_11 + p[5] * i_kh_12
        val p02n = p[2] * i_kh_11 + p[6] * i_kh_12
        val p03n = p[3] * i_kh_11 + p[7] * i_kh_12

        val p10n = p[0] * i_kh_21 + p[4] * i_kh_22
        val p11n = p[1] * i_kh_21 + p[5] * i_kh_22
        val p12n = p[2] * i_kh_21 + p[6] * i_kh_22
        val p13n = p[3] * i_kh_21 + p[7] * i_kh_22

        p[0] = p00n; p[1] = p01n; p[2] = p02n; p[3] = p03n
        p[4] = p10n; p[5] = p11n; p[6] = p12n; p[7] = p13n
        // rows 2 and 3 remain unchanged (matches the Swift code path)
    }

    fun getCurrentState(): KalmanState {
        if (!isInitialized) return KalmanState(Point(0.0, 0.0), null)
        val point = Point(x[0], x[1])
        val velocity = sqrt(x[2] * x[2] + x[3] * x[3])
        return KalmanState(point, velocity)
    }

    fun copy(): KalmanTracker {
        val newTracker = KalmanTracker(this.scaleFactor)
        newTracker.x = this.x.clone()
        newTracker.p = this.p.clone()
        newTracker.isInitialized = this.isInitialized
        return newTracker
    }
}
