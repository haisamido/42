# UTDF Binary Packet Generation from 42 CommLink Data

This document describes how to map 42's CommLink simulation data to UTDF
(Universal Tracking Data Format) binary records, as defined in NASA
453-HDBK-GN Section 4.2.2.

## References

- NASA 453-HDBK-GN, "Ground Network (GN) User Guide", Section 4.2.2, Table 4-1
- [UTDFpy](https://github.com/haisamido/UTDFpy) — Python UTDF encoder/decoder (provides the definitive byte-level format)
- `Include/42types.h` — `struct CommLinkType` definition (lines 1097-1175)
- `Source/AutoCode/TxRxIPC.c` — IPC marshalling of CommLink fields (lines 422-488)
- `Source/42report.c` — `WriteCommLinkToCsv()` (line 209)
- `Source/42commlink.c` — `CommLinkPerformance()` (line 450), `LinkGeometry()` (line 216)

## UTDF Record Layout (75 bytes, big-endian)

From UTDFpy `parsing.py`:

```
struct format: ">3s2sBHHIIIIIHIHHIBBBBHBBH18s3s"
```

| Offset | Field                          | Type   | Size | Description                              |
|--------|--------------------------------|--------|------|------------------------------------------|
| 0      | front                          | 3s     | 3    | Sync bytes `0x0D 0x0A 0x01`             |
| 3      | router                         | 2s     | 2    | Station router (ASCII, e.g. `"AA"`)      |
| 5      | year                           | B      | 1    | 2-digit year (e.g. 24 for 2024)         |
| 6      | sic                            | H      | 2    | Station ID Code                          |
| 8      | vid                            | H      | 2    | Vehicle ID                               |
| 10     | seconds_of_year                | I      | 4    | Seconds since Jan 1 00:00:00 UTC        |
| 14     | microseconds_of_year           | I      | 4    | Microsecond fraction                     |
| 18     | azimuth                        | I      | 4    | Angle (FOC: `angle * 2^32 / 2pi`)       |
| 22     | elevation                      | I      | 4    | Angle (FOC)                              |
| 26     | range_delay_hi                 | I      | 4    | Upper 4 bytes of 6-byte range delay     |
| 30     | range_delay_lo                 | H      | 2    | Lower 2 bytes of 6-byte range delay     |
| 32     | doppler_count_hi               | I      | 4    | Upper 4 bytes of 6-byte Doppler count   |
| 36     | doppler_count_lo               | H      | 2    | Lower 2 bytes of 6-byte Doppler count   |
| 38     | agc                            | H      | 2    | Automatic Gain Control                   |
| 40     | transmit_frequency             | I      | 4    | Transmit frequency (Hz / 10)            |
| 44     | transmit_antenna_type          | B      | 1    | Diameter (hi nybble) + geometry (lo)     |
| 45     | transmit_antenna_padid         | B      | 1    | Tx antenna pad ID                        |
| 46     | receive_antenna_type           | B      | 1    | Diameter (hi nybble) + geometry (lo)     |
| 47     | receive_antenna_padid          | B      | 1    | Rx antenna pad ID                        |
| 48     | mode                           | H      | 2    | Tracking mode bits                       |
| 50     | data_validity                  | B      | 1    | Bit flags (range, Doppler, angle valid)  |
| 51     | freq_band_and_transmission_type| B      | 1    | Band (hi nybble) + tx type (lo nybble)  |
| 52     | tracker_type_and_data_rate     | H      | 2    | Tracker type + data interval             |
| 54     | tdrss_only                     | 18s    | 18   | TDRSS-specific (zeros for non-TDRSS)    |
| 72     | rear                           | 3s     | 3    | Sync bytes `0x04 0x0F 0x0F`             |

### Encoding Details

**Angles (azimuth, elevation):** Stored as Fraction of Circle (FOC).
`raw = (uint32_t)(angle_rad / (2 * pi) * 2^32)`. Decoded:
`angle_rad = raw / 2^32 * 2 * pi`.

**Range delay:** Round-Trip Light Time in nanoseconds, stored as a 6-byte
split value. `range_delay_ns = (hi * 65536 + lo) / 256`. Range in km:
`range_km = (range_delay_ns - transponder_latency_ns) * c / 2e9` where
`c = 299792.458 km/s`.

**Doppler count:** Accumulated count stored as a 6-byte split value.
Doppler shift derived from consecutive records:
`doppler_shift_hz = (count_delta / dt - 240,000,000) / M` where
`M = 1000` for freq < 12 GHz, `M = 100` for freq >= 12 GHz.

**Transmit frequency:** Stored as Hz / 10 in a uint32.

**Data validity bits (byte 50):**

| Bit | Flag                               |
|-----|------------------------------------|
| 0   | is_range_valid                     |
| 1   | is_doppler_valid                   |
| 2   | is_angle_valid                     |
| 3   | is_angle_corrected_for_misalignment|
| 4   | is_angle_corrected_for_refraction  |
| 5   | is_range_corrected_for_refraction  |
| 6   | is_destruct_doppler                |
| 7   | is_side_lobe                       |

**Frequency band codes (hi nybble of byte 51):**

| Code | Band    | Frequency Range   |
|------|---------|-------------------|
| 1    | VHF     | < 300 MHz         |
| 2    | UHF     | 300 MHz - 3 GHz   |
| 3    | S-band  | 3 - 6 GHz         |
| 4    | C-band  | 6 - 8 GHz         |
| 5    | X-band  | 8 - 12.5 GHz      |
| 6    | Ku-band | > 12.5 GHz        |

**Transmission type codes (lo nybble of byte 51):**

| Code | Type       |
|------|------------|
| 0    | test       |
| 2    | simulated  |
| 3    | resubmit   |
| 4    | real-time  |
| 5    | playback   |

## CommLink Fields Available for UTDF

### Directly Mappable from `struct CommLinkType`

These fields on `L = &CommLink[Is]` map to UTDF observables:

| CommLink Field       | UTDF Field             | Conversion                                        |
|----------------------|------------------------|---------------------------------------------------|
| `L->Range`           | `range_delay`          | RTLT_ns = `2 * Range / c * 1e9`                  |
| `L->Doppler`         | `doppler_count`        | Accumulate: `(Doppler * M + 240e6) * dt`          |
| `L->RangeRate`       | (cross-check Doppler)  | Verify against Doppler-derived range rate          |
| `L->Carrier`         | `agc`                  | Scale dBw to uint16                                |
| `L->Freq`            | `transmit_frequency`   | `(uint32_t)(Freq / 10)`                           |
| `L->Freq`            | `frequency_band`       | Derive band code from frequency range              |
| `L->PathIsOcculted`  | `data_validity`        | Set `is_range_valid`, `is_doppler_valid` when clear|
| `L->Delay`           | (alternative range)    | RTLT_ns = `2 * Delay * 1e9`                       |
| `L->TxPathDirN[3]`   | `azimuth`, `elevation` | Transform to ENU frame (see below)                 |
| `L->RxPathDirN[3]`   | `azimuth`, `elevation` | For downlink, ground station is Rx                 |
| `L->TxCAN[3][3]`     | (for az/el transform)  | ENU rotation for uplink ground station             |
| `L->RxCAN[3][3]`     | (for az/el transform)  | ENU rotation for downlink ground station           |
| `L->LinkType`        | (logic select)         | Determines which terminal is the ground station    |

### Available but NOT Currently IPC-Exported

These fields exist in `CommLinkType` but are not marked `[~=~]` and are not
sent over sockets or written to CSV:

```
L->TxPathDirN[3]    L->RxPathDirN[3]     — needed for azimuth/elevation
L->TxCAN[3][3]      L->RxCAN[3][3]       — needed for ENU frame transform
L->Freq             L->Wavelength         — needed for transmit_frequency
L->LinkType                               — needed to identify ground station
L->TxID             L->RxID               — terminal identifiers
```

### IPC-Exported Fields (marked `[~=~]` in `42types.h`)

These 7 fields are sent via socket IPC by `TxRxIPC.c` and written to CSV:

```
L->Doppler          double   Hz         TxRxIPC.c:426
L->Delay            double   sec        TxRxIPC.c:435
L->Carrier          double   dBw        TxRxIPC.c:444
L->CNR              double   dB         TxRxIPC.c:453
L->Range            double   m          TxRxIPC.c:462
L->RangeRate        double   m/s        TxRxIPC.c:471
L->PathIsOcculted   long     0/1        TxRxIPC.c:480
```

### NOT in CommLink — Required from External Configuration

These UTDF fields have no counterpart in 42 and must be supplied via
a configuration file (e.g. `Inp_UTDF.txt`):

| UTDF Field                  | Description                                   |
|-----------------------------|-----------------------------------------------|
| `sic`                       | NASA GN station ID (e.g. 86 = White Sands)    |
| `vid`                       | Spacecraft vehicle ID (e.g. 99 = SDO)         |
| `transmit_antenna_type`     | Diameter + geometry code (e.g. 0x40 = 12m az-el) |
| `transmit_antenna_padid`    | Station antenna pad number                     |
| `receive_antenna_type`      | Diameter + geometry code                       |
| `receive_antenna_padid`     | Station antenna pad number                     |
| `tracking_mode`             | Autotrack (0), program track (1), manual (2), slaved (3) |
| `tracker_type`              | SRE (1), SGLS (4), TDRSS (6), etc.            |
| `transmission_type`         | Simulated (2) for simulation data              |
| `transponder_latency`       | Spacecraft transponder delay (nanoseconds)     |

### Time Fields

UTDF time (`year`, `seconds_of_year`, `microseconds_of_year`) is derived
from the global `UTC` struct (defined in `Kit/Include/timekit.h:34`):

```c
struct DateType {
   double JulDay;
   long Year;
   long Month;
   long Day;
   long doy;
   long Hour;
   long Minute;
   double Second;
};
```

Conversion:

```
year              = UTC.Year % 100
seconds_of_year   = (UTC.doy - 1) * 86400 + UTC.Hour * 3600 + UTC.Minute * 60 + (long)UTC.Second
microseconds      = (UTC.Second - floor(UTC.Second)) * 1e6
```

The simulation epoch is set in `Inp_Sim.txt` (lines 16-17):
`04 08 2024` / `00 00 0.00` (Month Day Year / Hour Min Sec UTC).

## Azimuth/Elevation Computation

The CSV output does not contain antenna pointing angles. These must be
computed from the internal path direction vectors and antenna frame rotations.

For **UPLINK** (ground station is Tx):
```c
/* Path direction in ground station antenna (ENU) frame */
MxV(L->TxCAN, L->TxPathDirN, PathDirA);  /* A = antenna frame = ENU */
/* East = PathDirA[0], North = PathDirA[1], Up = PathDirA[2] */
Az = atan2(PathDirA[0], PathDirA[1]);     /* from North, clockwise */
El = atan2(PathDirA[2], sqrt(PathDirA[0]*PathDirA[0] + PathDirA[1]*PathDirA[1]));
```

For **DOWNLINK** (ground station is Rx):
```c
MxV(L->RxCAN, L->RxPathDirN, PathDirA);
/* Same Az/El formula */
```

For **CROSSLINK**: No ground station. Set azimuth = elevation = 0 and
mark `is_angle_valid = 0` in `data_validity`.

UTDF FOC encoding: `raw = (uint32_t)(angle_rad / TWO_PI * 4294967296.0)`

## Doppler Count Accumulation

UTDF stores an accumulated Doppler count, not an instantaneous frequency
shift. 42 provides `L->Doppler` in Hz (instantaneous shift). The conversion:

```
M     = (Freq >= 12e9) ? 100.0 : 1000.0
K     = (Freq >= 2e9)  ? 240.0/221.0 : 1.0
dt    = time interval between UTDF records (seconds)

count_rate       = L->Doppler * M + 240,000,000
acc_doppler     += count_rate * dt
```

The accumulated count is stored as a 6-byte split value:
```
doppler_count_hi = (uint32_t)(acc_doppler / 65536)
doppler_count_lo = (uint16_t)(acc_doppler - doppler_count_hi * 65536)
```

UTDFpy decodes back to shift via:
`doppler_shift = (count_delta / dt - 240,000,000) / M`

## CSV Columns vs UTDF Fields Summary

The 17 CSV columns from `WriteCommLinkToCsv()` and their UTDF relevance:

| CSV Column       | UTDF Use           | Notes                              |
|-------------------|--------------------|------------------------------------|
| Time              | time fields        | SimTime -> UTC -> year/soy/usoy    |
| Doppler           | doppler_count      | Accumulated, not instantaneous     |
| Loss              | --                 | Not a UTDF observable              |
| Delay             | range_delay        | Alternative to Range: 2*Delay*1e9  |
| Carrier           | agc                | Approximate mapping                |
| Noise             | --                 | Not a UTDF observable              |
| CNR               | --                 | Not a UTDF observable              |
| EIRP              | --                 | Not a UTDF observable              |
| FSPL              | --                 | Not a UTDF observable              |
| PwrFluxDens       | --                 | Not a UTDF observable              |
| Range             | range_delay        | RTLT_ns = 2*Range/c*1e9           |
| RangeRate         | (cross-check)      | Verify Doppler-derived range rate  |
| TxAntGain         | --                 | Not a UTDF observable              |
| RxAntGain         | --                 | Not a UTDF observable              |
| TxOcculted        | --                 | Subsumed by PathIsOcculted         |
| RxOcculted        | --                 | Subsumed by PathIsOcculted         |
| PathIsOcculted    | data_validity      | Clears range/Doppler valid bits    |
