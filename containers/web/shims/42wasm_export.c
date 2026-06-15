/*    42wasm_export.c — Exported WASM API for browser-side JavaScript    */
/*    Wraps 42's existing C functions into a simple init/step/get_state  */
/*    interface callable from JS via Module.ccall() or Module._fn().     */

#include "42.h"
#include <emscripten/emscripten.h>

/**********************************************************************/
/* SimStateSnapshot — flat struct readable from JS via HEAPF64.       */
/* All fields are doubles for uniform memory layout.                  */
/* Total: 16 doubles = 128 bytes starting at the returned pointer.    */
typedef struct {
   double SimTime;        /* [0]  Current simulation time (sec)      */
   double PosN[3];        /* [1-3]  SC[0] pos in N frame (m)         */
   double VelN[3];        /* [4-6]  SC[0] vel in N frame (m/s)       */
   double qbn[4];         /* [7-10] SC[0] body quaternion in N       */
   double svn[3];         /* [11-13] Sun vector in N (unit)          */
   double Nlink_d;        /* [14] Number of comm links (as double)   */
   double Done;           /* [15] 1.0 if sim complete, else 0.0      */
} SimStateSnapshot;

static SimStateSnapshot State;

/**********************************************************************/
EMSCRIPTEN_KEEPALIVE
void sim_init(void)
{
   char *argv[] = {"42", "InOut", NULL};
   InitSim(2, argv);
   CmdInterpreter();
   InitInterProcessComm();
}

/**********************************************************************/
/* Returns 1 when simulation is complete, 0 otherwise.                */
EMSCRIPTEN_KEEPALIVE
int sim_step(void)
{
   return (int)SimStep();
}

/**********************************************************************/
/* Returns pointer to SimStateSnapshot struct in WASM linear memory.  */
/* JS reads it via: new Float64Array(Module.HEAPF64.buffer, ptr, 16)  */
EMSCRIPTEN_KEEPALIVE
double *sim_get_state(void)
{
   long i;

   State.SimTime = SimTime;
   State.Done = (SimTime >= STOPTIME) ? 1.0 : 0.0;

   if (Nsc > 0 && SC[0].Exists) {
      for (i = 0; i < 3; i++) {
         State.PosN[i] = SC[0].PosN[i];
         State.VelN[i] = SC[0].VelN[i];
         State.svn[i]  = SC[0].svn[i];
      }
      for (i = 0; i < 4; i++) {
         State.qbn[i] = SC[0].qn[i];
      }
   }

   State.Nlink_d = (double)Nlink;

   return (double *)&State;
}

/**********************************************************************/
EMSCRIPTEN_KEEPALIVE
double sim_get_time(void)
{
   return SimTime;
}

/**********************************************************************/
EMSCRIPTEN_KEEPALIVE
double sim_get_stoptime(void)
{
   return STOPTIME;
}

/**********************************************************************/
EMSCRIPTEN_KEEPALIVE
double sim_get_dtsim(void)
{
   return DTSIM;
}

/**********************************************************************/
EMSCRIPTEN_KEEPALIVE
long sim_get_nsc(void)
{
   return Nsc;
}
