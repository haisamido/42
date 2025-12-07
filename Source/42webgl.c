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

/* Global WebGL context */
EMSCRIPTEN_WEBGL_CONTEXT_HANDLE webgl_context = 0;
int canvas_width = 800;
int canvas_height = 600;

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
    /* WebGL initialization is handled through Module initialization */
    /* Initialize WebGL context */
    printf("HandoffToGui: Initializing WebGL\n");

    if (!InitWebGL("#canvas")) {
        printf("Failed to initialize WebGL\n");
        return -1;
    }

    /* Set up basic GL state */
    glEnable(GL_DEPTH_TEST);
    glClearColor(0.0f, 0.0f, 0.2f, 1.0f);

    /* Set up GLUT-style callbacks for rendering */
    /* Note: CamRenderExec is defined in 42gl.c */
    extern void CamRenderExec(void);
    extern void Idle(void);

    glutDisplayFunc(CamRenderExec);
    glutIdleFunc(Idle);

    /* Start the WebGL main loop */
    glutMainLoop();

    printf("WebGL initialized successfully\n");
    return 0;
}

/* WebGL Idle function - runs the simulation loop */
void Idle(void)
{
    extern long SimStep(void);
    extern void CamRenderExec(void);
    extern long GLOutFlag;
    extern long PauseFlag;
    long Done = 0;

    if (PauseFlag) {
        /* When paused, just render the current state */
        CamRenderExec();
    }
    else {
        /* Run simulation step */
        Done = SimStep();

        /* Render if GL output is enabled */
        if (GLOutFlag) {
            CamRenderExec();
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
