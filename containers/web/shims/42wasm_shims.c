/*    42wasm_shims.c — OS function stubs for WASM build                  */
/*    These functions exist in 42's codebase but have no meaning in      */
/*    a WebAssembly environment. They are stubbed to satisfy the linker. */

#include "42.h"
#include <time.h>
#include <sys/time.h>
#include <emscripten/emscripten.h>

/**********************************************************************/
/* nanosleep — called by AdvanceTime() in REAL_TIME mode only.        */
/* The WASM build runs in FAST_TIME, so this is never actually called */
/* but must link.                                                     */
int __wrap_nanosleep(const struct timespec *req, struct timespec *rem)
{
   (void)req;
   (void)rem;
   return 0;
}

/**********************************************************************/
/* gettimeofday — used by timekit.c usec() and RealSystemTime().      */
/* Map to Emscripten's high-resolution timer.                         */
int __wrap_gettimeofday(struct timeval *tv, void *tz)
{
   (void)tz;
   if (tv) {
      double ms = emscripten_get_now();
      tv->tv_sec  = (time_t)(ms / 1000.0);
      tv->tv_usec = (suseconds_t)((ms - tv->tv_sec * 1000.0) * 1000.0);
   }
   return 0;
}

/**********************************************************************/
/* NOS3Time — called by AdvanceTime() in NOS3_TIME mode only.         */
/* Not applicable to WASM. Stub satisfies linker.                     */
void NOS3Time(long *year, long *day_of_year, long *month, long *day,
              long *hour, long *minute, double *second)
{
   (void)year; (void)day_of_year; (void)month; (void)day;
   (void)hour; (void)minute; (void)second;
}

/**********************************************************************/
/* AcFsw — Attitude Control flight software, defined in AcApp.c.     */
/* AcApp.c is the standalone AC app, not compiled for WASM.           */
/* 42fsw.c calls AcFsw() for certain FSW tags. Stub is a no-op.      */
void AcFsw(struct AcType *AC)
{
   (void)AC;
}
