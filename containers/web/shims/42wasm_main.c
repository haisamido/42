/*    42wasm_main.c — Empty main() for WASM build                       */
/*    Replaces Source/42main.c so Emscripten links without auto-running  */
/*    the simulation. JavaScript calls sim_init() / sim_step() instead.  */

int main(int argc, char **argv)
{
   return 0;
}
