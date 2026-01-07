/*    This file is distributed with 42,                               */
/*    the (mostly harmless) spacecraft dynamics simulation            */
/*    created by Eric Stoneking of NASA Goddard Space Flight Center   */

/*    Copyright 2010 United States Government                         */
/*    as represented by the Administrator                             */
/*    of the National Aeronautics and Space Administration.           */

/*    No copyright is claimed in the United States                    */
/*    under Title 17, U.S. Code.                                      */

/*    All Other Rights Reserved.                                      */


#ifdef __WASM__

#include <stdio.h>
#include <stdlib.h>
#include <math.h>
#include <string.h>
#include "42webgl.h"
#include "42types.h"

/* Global WebGL context */
EMSCRIPTEN_WEBGL_CONTEXT_HANDLE webgl_context = 0;
int canvas_width = 800;
int canvas_height = 600;

/* Track if main loop has been started */
static int main_loop_started = 0;

/* Track if simulation is initialized and ready to render */
static int simulation_initialized = 0;

/* Callback function pointers */
static void (*display_func)(void) = NULL;
static void (*reshape_func)(int width, int height) = NULL;
static void (*keyboard_func)(unsigned char key, int x, int y) = NULL;
static void (*mouse_func)(int button, int state, int x, int y) = NULL;
static void (*motion_func)(int x, int y) = NULL;
static void (*idle_func)(void) = NULL;

/* Mouse state */
static int mouse_down = 0;

/*********************************************************************/
int InitWebGL(const char* canvas_id)
{
    EmscriptenWebGLContextAttributes attrs;
    emscripten_webgl_init_context_attributes(&attrs);

    attrs.alpha = 1;
    attrs.depth = 1;
    attrs.stencil = 1;
    attrs.antialias = 1;
    attrs.premultipliedAlpha = 0;
    attrs.preserveDrawingBuffer = 0;
    attrs.powerPreference = EM_WEBGL_POWER_PREFERENCE_HIGH_PERFORMANCE;
    attrs.failIfMajorPerformanceCaveat = 0;
    attrs.majorVersion = 2;
    attrs.minorVersion = 0;
    attrs.enableExtensionsByDefault = 1;

    webgl_context = emscripten_webgl_create_context(canvas_id, &attrs);
    if (webgl_context <= 0) {
        printf("Failed to create WebGL context\n");
        return 0;
    }

    emscripten_webgl_make_context_current(webgl_context);

    /* Get canvas size */
    emscripten_get_canvas_element_size(canvas_id, &canvas_width, &canvas_height);

    /* Set up event callbacks */
    emscripten_set_mousedown_callback(canvas_id, NULL, 1, WebGL_MouseCallback);
    emscripten_set_mouseup_callback(canvas_id, NULL, 1, WebGL_MouseCallback);
    emscripten_set_mousemove_callback(canvas_id, NULL, 1, WebGL_MouseCallback);
    emscripten_set_wheel_callback(canvas_id, NULL, 1, WebGL_WheelCallback);
    emscripten_set_keydown_callback(EMSCRIPTEN_EVENT_TARGET_WINDOW, NULL, 1, WebGL_KeyCallback);
    emscripten_set_keyup_callback(EMSCRIPTEN_EVENT_TARGET_WINDOW, NULL, 1, WebGL_KeyCallback);
    emscripten_set_resize_callback(EMSCRIPTEN_EVENT_TARGET_WINDOW, NULL, 1, WebGL_ResizeCallback);

    printf("WebGL initialized: %dx%d\n", canvas_width, canvas_height);
    return 1;
}

/*********************************************************************/
EM_BOOL WebGL_MouseCallback(int eventType, const EmscriptenMouseEvent *mouseEvent, void *userData)
{
    if (eventType == EMSCRIPTEN_EVENT_MOUSEDOWN) {
        mouse_down = 1;
        if (mouse_func) {
            mouse_func(mouseEvent->button, 0, mouseEvent->targetX, mouseEvent->targetY);
        }
    }
    else if (eventType == EMSCRIPTEN_EVENT_MOUSEUP) {
        mouse_down = 0;
        if (mouse_func) {
            mouse_func(mouseEvent->button, 1, mouseEvent->targetX, mouseEvent->targetY);
        }
    }
    else if (eventType == EMSCRIPTEN_EVENT_MOUSEMOVE) {
        if (motion_func && mouse_down) {
            motion_func(mouseEvent->targetX, mouseEvent->targetY);
        }
    }
    return EM_TRUE;
}

/*********************************************************************/
EM_BOOL WebGL_WheelCallback(int eventType, const EmscriptenWheelEvent *wheelEvent, void *userData)
{
    /* Handle mouse wheel events if needed */
    return EM_TRUE;
}

/*********************************************************************/
EM_BOOL WebGL_KeyCallback(int eventType, const EmscriptenKeyboardEvent *keyEvent, void *userData)
{
    if (eventType == EMSCRIPTEN_EVENT_KEYDOWN && keyboard_func) {
        if (strlen(keyEvent->key) == 1) {
            keyboard_func(keyEvent->key[0], 0, 0);
        }
    }
    return EM_TRUE;
}

/*********************************************************************/
EM_BOOL WebGL_ResizeCallback(int eventType, const EmscriptenUiEvent *uiEvent, void *userData)
{
    int width, height;
    emscripten_get_canvas_element_size("#canvas", &width, &height);
    canvas_width = width;
    canvas_height = height;

    if (reshape_func) {
        reshape_func(width, height);
    }
    return EM_TRUE;
}

/*********************************************************************/
void WebGLRenderLoop(void)
{
    if (idle_func) {
        idle_func();
    }
    if (display_func) {
        display_func();
    }
}

/*********************************************************************/
/* GLUT-compatible stub functions */
/*********************************************************************/

void webgl_glutSwapBuffers(void)
{
    /* WebGL automatically swaps buffers */
}

void webgl_glutPostRedisplay(void)
{
    /* Request animation frame */
}

void webgl_glutSetWindow(int win)
{
    /* WebGL: single window/canvas context */
}

int webgl_glutCreateWindow(const char* title)
{
    /* Set document title */
    EM_ASM({
        document.title = UTF8ToString($0);
    }, title);
    return 1;
}

void webgl_glutDisplayFunc(void (*func)(void))
{
    display_func = func;
}

void webgl_glutReshapeFunc(void (*func)(int width, int height))
{
    reshape_func = func;
    if (func) {
        func(canvas_width, canvas_height);
    }
}

void webgl_glutKeyboardFunc(void (*func)(unsigned char key, int x, int y))
{
    keyboard_func = func;
}

void webgl_glutMouseFunc(void (*func)(int button, int state, int x, int y))
{
    mouse_func = func;
}

void webgl_glutMotionFunc(void (*func)(int x, int y))
{
    motion_func = func;
}

void webgl_glutIdleFunc(void (*func)(void))
{
    idle_func = func;
}

void webgl_glutTimerFunc(unsigned int millis, void (*func)(int value), int value)
{
    /* Timer functionality - could be implemented with setTimeout */
}

void webgl_glutMainLoop(void)
{
    /* Start the render loop */
    emscripten_set_main_loop(WebGLRenderLoop, 0, 1);
}

/*********************************************************************/
/* WebGL-aware capability management */
/*********************************************************************/

/*
 * These functions wrap glEnable/glDisable to handle OpenGL capabilities
 * that are not supported in WebGL ES 2.0/3.0.
 *
 * Supported capabilities are passed through to the real GL functions.
 * Unsupported legacy capabilities (lighting, normalize, etc.) are silently ignored.
 */

/* Declare the real OpenGL functions (before macro redefinition) */
extern void glEnable(GLenum cap);
extern void glDisable(GLenum cap);

void webgl_glEnable(GLenum cap)
{
    switch(cap) {
        /* Capabilities supported in WebGL ES 2.0/3.0 */
        case GL_BLEND:
        case GL_CULL_FACE:
        case GL_DEPTH_TEST:
        case GL_DITHER:
        case GL_POLYGON_OFFSET_FILL:
        case GL_SAMPLE_ALPHA_TO_COVERAGE:
        case GL_SAMPLE_COVERAGE:
        case GL_SCISSOR_TEST:
        case GL_STENCIL_TEST:
            /* Pass through to real OpenGL function via asm to avoid macro expansion */
            EM_ASM({ GLctx.enable($0); }, cap);
            break;

        /* WebGL ES 3.0 specific capabilities */
        case GL_RASTERIZER_DISCARD:
            #ifdef GL_ES_VERSION_3_0
            EM_ASM({ GLctx.enable($0); }, cap);
            #endif
            break;

        /* Texture capabilities (supported) */
        case GL_TEXTURE_2D:
        case GL_TEXTURE_CUBE_MAP:
            /* Note: In modern GL, these are enabled per-texture unit, not globally */
            /* For compatibility, we'll allow the call but it's effectively a no-op */
            /* Textures are enabled by binding them with glBindTexture */
            break;

        /* Legacy capabilities not supported in WebGL - silently ignore */
        case GL_LIGHTING:
        case GL_NORMALIZE:
        case GL_COLOR_MATERIAL:
        case GL_LINE_SMOOTH:
        case GL_POINT_SMOOTH:
        case GL_POLYGON_SMOOTH:
        case GL_ALPHA_TEST:
        case GL_AUTO_NORMAL:
        case GL_FOG:
        case GL_LIGHT0:
        case GL_LIGHT1:
        case GL_LIGHT2:
        case GL_LIGHT3:
        case GL_LIGHT4:
        case GL_LIGHT5:
        case GL_LIGHT6:
        case GL_LIGHT7:
        case GL_TEXTURE_1D:
        case GL_TEXTURE_3D:
            /* Silently ignore - these are handled by shaders in WebGL */
            break;

        default:
            /* Unknown capability - try to enable it anyway, might be valid */
            EM_ASM({
                try {
                    GLctx.enable($0);
                } catch(e) {
                    console.warn('WebGL: Cannot enable capability 0x' + $0.toString(16));
                }
            }, cap);
            break;
    }
}

void webgl_glDisable(GLenum cap)
{
    switch(cap) {
        /* Capabilities supported in WebGL ES 2.0/3.0 */
        case GL_BLEND:
        case GL_CULL_FACE:
        case GL_DEPTH_TEST:
        case GL_DITHER:
        case GL_POLYGON_OFFSET_FILL:
        case GL_SAMPLE_ALPHA_TO_COVERAGE:
        case GL_SAMPLE_COVERAGE:
        case GL_SCISSOR_TEST:
        case GL_STENCIL_TEST:
            /* Pass through to real OpenGL function via asm to avoid macro expansion */
            EM_ASM({ GLctx.disable($0); }, cap);
            break;

        /* WebGL ES 3.0 specific capabilities */
        case GL_RASTERIZER_DISCARD:
            #ifdef GL_ES_VERSION_3_0
            EM_ASM({ GLctx.disable($0); }, cap);
            #endif
            break;

        /* Texture capabilities (supported) */
        case GL_TEXTURE_2D:
        case GL_TEXTURE_CUBE_MAP:
            /* Note: In modern GL, these are enabled per-texture unit, not globally */
            /* For compatibility, we'll allow the call but it's effectively a no-op */
            break;

        /* Legacy capabilities not supported in WebGL - silently ignore */
        case GL_LIGHTING:
        case GL_NORMALIZE:
        case GL_COLOR_MATERIAL:
        case GL_LINE_SMOOTH:
        case GL_POINT_SMOOTH:
        case GL_POLYGON_SMOOTH:
        case GL_ALPHA_TEST:
        case GL_AUTO_NORMAL:
        case GL_FOG:
        case GL_LIGHT0:
        case GL_LIGHT1:
        case GL_LIGHT2:
        case GL_LIGHT3:
        case GL_LIGHT4:
        case GL_LIGHT5:
        case GL_LIGHT6:
        case GL_LIGHT7:
        case GL_TEXTURE_1D:
        case GL_TEXTURE_3D:
            /* Silently ignore - these are handled by shaders in WebGL */
            break;

        default:
            /* Unknown capability - try to disable it anyway, might be valid */
            EM_ASM({
                try {
                    GLctx.disable($0);
                } catch(e) {
                    console.warn('WebGL: Cannot disable capability 0x' + $0.toString(16));
                }
            }, cap);
            break;
    }
}

void webgl_glBindTexture(GLenum target, GLuint texture)
{
    switch(target) {
        case GL_TEXTURE_2D:
        case GL_TEXTURE_CUBE_MAP:
            /* Supported texture targets - pass through */
            EM_ASM({ GLctx.bindTexture($0, GL.textures[$1]); }, target, texture);
            break;

        case GL_TEXTURE_1D:
        case GL_TEXTURE_3D:
            /* WebGL doesn't support 1D or 3D textures - silently ignore */
            /* In a full implementation, these would need to be converted to 2D textures */
            break;

        default:
            /* Unknown target - try anyway */
            EM_ASM({
                try {
                    GLctx.bindTexture($0, GL.textures[$1]);
                } catch(e) {
                    console.warn('WebGL: Cannot bind texture target 0x' + $0.toString(16));
                }
            }, target, texture);
            break;
    }
}

/*********************************************************************/
/* GLU function implementations */
/*********************************************************************/

void webgl_gluPerspective(GLdouble fovy, GLdouble aspect, GLdouble zNear, GLdouble zFar)
{
    GLdouble f = 1.0 / tan(fovy * M_PI / 360.0);
    GLdouble matrix[16];

    memset(matrix, 0, sizeof(matrix));
    matrix[0] = f / aspect;
    matrix[5] = f;
    matrix[10] = (zFar + zNear) / (zNear - zFar);
    matrix[11] = -1.0;
    matrix[14] = (2.0 * zFar * zNear) / (zNear - zFar);

    glMultMatrixd(matrix);
}

void webgl_gluLookAt(GLdouble eyeX, GLdouble eyeY, GLdouble eyeZ,
                     GLdouble centerX, GLdouble centerY, GLdouble centerZ,
                     GLdouble upX, GLdouble upY, GLdouble upZ)
{
    GLdouble forward[3], side[3], up[3];
    GLdouble matrix[16];

    /* Compute forward vector */
    forward[0] = centerX - eyeX;
    forward[1] = centerY - eyeY;
    forward[2] = centerZ - eyeZ;

    /* Normalize forward */
    GLdouble len = sqrt(forward[0]*forward[0] + forward[1]*forward[1] + forward[2]*forward[2]);
    forward[0] /= len;
    forward[1] /= len;
    forward[2] /= len;

    /* Compute side = forward x up */
    side[0] = forward[1]*upZ - forward[2]*upY;
    side[1] = forward[2]*upX - forward[0]*upZ;
    side[2] = forward[0]*upY - forward[1]*upX;

    /* Normalize side */
    len = sqrt(side[0]*side[0] + side[1]*side[1] + side[2]*side[2]);
    side[0] /= len;
    side[1] /= len;
    side[2] /= len;

    /* Recompute up = side x forward */
    up[0] = side[1]*forward[2] - side[2]*forward[1];
    up[1] = side[2]*forward[0] - side[0]*forward[2];
    up[2] = side[0]*forward[1] - side[1]*forward[0];

    /* Build matrix */
    memset(matrix, 0, sizeof(matrix));
    matrix[0] = side[0];
    matrix[4] = side[1];
    matrix[8] = side[2];
    matrix[1] = up[0];
    matrix[5] = up[1];
    matrix[9] = up[2];
    matrix[2] = -forward[0];
    matrix[6] = -forward[1];
    matrix[10] = -forward[2];
    matrix[15] = 1.0;

    glMultMatrixd(matrix);
    glTranslated(-eyeX, -eyeY, -eyeZ);
}

void webgl_gluOrtho2D(GLdouble left, GLdouble right, GLdouble bottom, GLdouble top)
{
    /* gluOrtho2D is equivalent to glOrtho with near=-1 and far=1 */
    GLdouble matrix[16];

    memset(matrix, 0, sizeof(matrix));
    matrix[0] = 2.0 / (right - left);
    matrix[5] = 2.0 / (top - bottom);
    matrix[10] = -1.0;  /* 2D: near=-1, far=1 */
    matrix[12] = -(right + left) / (right - left);
    matrix[13] = -(top + bottom) / (top - bottom);
    matrix[15] = 1.0;

    glMultMatrixd(matrix);
}

/*********************************************************************/
/* GUI functions required by 42 */
/*********************************************************************/

/* Frame counter for visual feedback */
static int frame_count = 0;
static double sim_time = 0.0;

/* Simple WebGL rendering to show activity */
void WebGLRenderFrame(void)
{
    frame_count++;

    /* Clear with a color that changes based on frame */
    float r = 0.1f + 0.05f * (float)(frame_count % 20) / 20.0f;
    float g = 0.1f + 0.05f * (float)((frame_count + 7) % 20) / 20.0f;
    float b = 0.2f + 0.1f * (float)((frame_count + 13) % 20) / 20.0f;

    glClearColor(r, g, b, 1.0f);
    glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);

    /* Enable depth testing */
    glEnable(GL_DEPTH_TEST);

    /* Update canvas overlay with simulation info */
    char info[256];
    snprintf(info, sizeof(info), "WebGL Active | Frame: %d | Time: %.1f",
             frame_count, sim_time);

    EM_ASM({
        var overlay = document.getElementById('canvasInfo');
        if (overlay) {
            overlay.textContent = UTF8ToString($0);
        }
    }, info);
}

/* Update simulation time from 42 */
void WebGLUpdateSimTime(double time)
{
    sim_time = time;
}

int HandoffToGui(int argc, char **argv)
{
    /* In WebAssembly, we need to set up the main loop but only once.
     * This function is called from main() after initialization.
     * We start the main loop here, which will call our Idle() function.
     */

    printf("HandoffToGui: Initializing WebGL\n");

    /* Initialize WebGL context if not already done */
    if (webgl_context == 0) {
        if (!InitWebGL("#canvas")) {
            printf("Failed to initialize WebGL\n");
            return -1;
        }
    }

    /* Set up basic GL state */
    glEnable(GL_DEPTH_TEST);
    glClearColor(0.0f, 0.0f, 0.2f, 1.0f);

    /* Load shaders - CRITICAL for WebGL rendering */
    #ifdef _USE_SHADERS_
    extern void LoadCamShaders(void);
    printf("HandoffToGui: Loading shaders\n");
    LoadCamShaders();
    printf("HandoffToGui: Shaders loaded\n");
    #endif

    /* Set up GLUT-style callbacks for rendering */
    extern void CamRenderExec(void);
    extern void Idle(void);

    glutDisplayFunc(CamRenderExec);
    glutIdleFunc(Idle);

    /* Mark simulation as initialized and ready to render - MUST be before glutMainLoop */
    simulation_initialized = 1;
    printf("HandoffToGui: Simulation marked as initialized\n");

    /* Start the WebGL main loop - but only if not already started */
    if (!main_loop_started) {
        printf("HandoffToGui: Starting WebGL main loop\n");
        main_loop_started = 1;
        glutMainLoop();
        /* Note: glutMainLoop() calls emscripten_set_main_loop() which returns immediately
         * in WebAssembly. The loop will continue running in the background. */
    }
    else {
        printf("HandoffToGui: Main loop already running\n");
    }

    printf("HandoffToGui: WebGL initialized successfully\n");

    return 0;
}

/* WebGL Idle function - runs the simulation loop */
void Idle(void)
{
    extern long SimStep(void);
    extern void CamRenderExec(void);
    extern long GLOutFlag;
    extern long PauseFlag;
    extern struct POVType POV;
    long Done = 0;

    /* Don't do anything until simulation is initialized */
    if (!simulation_initialized) {
        /* Just clear the screen while waiting */
        glClearColor(0.1f, 0.1f, 0.2f, 1.0f);
        glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);
        return;
    }

    if (PauseFlag) {
        /* When paused, just render the current state */
        if (GLOutFlag) {
            CamRenderExec();
        }
    }
    else {
        /* Reset POV angular velocity before simulation step */
        POV.w[0] = 0.0;
        POV.w[1] = 0.0;
        POV.w[2] = 0.0;

        /* Run simulation step FIRST to populate data structures */
        printf("Idle: About to call SimStep()\n");
        Done = SimStep();
        printf("Idle: SimStep() returned Done=%ld\n", Done);

        /* Now it's safe to render with updated positions */
        if (GLOutFlag) {
            printf("Idle: About to call CamRenderExec()\n");
            CamRenderExec();
            printf("Idle: CamRenderExec() completed\n");
        }

        /* Exit if simulation is done */
        if (Done) {
            printf("Simulation complete in Idle loop\n");
        }
    }
}

long GuiCmdInterpreter(char CmdLine[512], double *CmdTime)
{
    /* Stub for command interpreter in WebGL mode */
    /* Commands could be sent via WebSocket or browser console */
    return 0;
}

#endif /* __WASM__ */
