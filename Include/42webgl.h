/*    This file is distributed with 42,                               */
/*    the (mostly harmless) spacecraft dynamics simulation            */
/*    created by Eric Stoneking of NASA Goddard Space Flight Center   */

/*    Copyright 2010 United States Government                         */
/*    as represented by the Administrator                             */
/*    of the National Aeronautics and Space Administration.           */

/*    No copyright is claimed in the United States                    */
/*    under Title 17, U.S. Code.                                      */

/*    All Other Rights Reserved.                                      */


#ifndef __42WEBGL_H__
#define __42WEBGL_H__

#ifdef __WASM__

#include <GLES3/gl3.h>
#include <emscripten.h>
#include <emscripten/html5.h>

/*
** WebGL/Emscripten adapter for 42
** This provides compatibility between desktop OpenGL/GLUT and WebGL
*/

/* Canvas and context */
extern EMSCRIPTEN_WEBGL_CONTEXT_HANDLE webgl_context;
extern int canvas_width;
extern int canvas_height;

/* Initialize WebGL context */
int InitWebGL(const char* canvas_id);

/* WebGL rendering loop */
void WebGLRenderLoop(void);

/* Mouse and keyboard callbacks */
EM_BOOL WebGL_MouseCallback(int eventType, const EmscriptenMouseEvent *mouseEvent, void *userData);
EM_BOOL WebGL_WheelCallback(int eventType, const EmscriptenWheelEvent *wheelEvent, void *userData);
EM_BOOL WebGL_KeyCallback(int eventType, const EmscriptenKeyboardEvent *keyEvent, void *userData);
EM_BOOL WebGL_ResizeCallback(int eventType, const EmscriptenUiEvent *uiEvent, void *userData);

/* GLUT-compatible stubs for WebGL */
void webgl_glutSwapBuffers(void);
void webgl_glutPostRedisplay(void);
void webgl_glutSetWindow(int win);
int webgl_glutCreateWindow(const char* title);
void webgl_glutDisplayFunc(void (*func)(void));
void webgl_glutReshapeFunc(void (*func)(int width, int height));
void webgl_glutKeyboardFunc(void (*func)(unsigned char key, int x, int y));
void webgl_glutMouseFunc(void (*func)(int button, int state, int x, int y));
void webgl_glutMotionFunc(void (*func)(int x, int y));
void webgl_glutIdleFunc(void (*func)(void));
void webgl_glutTimerFunc(unsigned int millis, void (*func)(int value), int value);
void webgl_glutMainLoop(void);

/* GLUT text rendering stubs */
#define glutBitmapCharacter(font, character) /* No-op in WebGL */
#define glutStrokeCharacter(font, character) /* No-op in WebGL */

/* GLUT window management stubs */
#define glutInitWindowSize(width, height) /* No-op in WebGL */
#define glutInitWindowPosition(x, y) /* No-op in WebGL */

/* WebGL type compatibility - no GLdouble in OpenGL ES */
#ifndef GLdouble
#define GLdouble double
#endif

/* GLU functions that may not be available in WebGL */
void webgl_gluPerspective(GLdouble fovy, GLdouble aspect, GLdouble zNear, GLdouble zFar);
void webgl_gluLookAt(GLdouble eyeX, GLdouble eyeY, GLdouble eyeZ,
                     GLdouble centerX, GLdouble centerY, GLdouble centerZ,
                     GLdouble upX, GLdouble upY, GLdouble upZ);
void webgl_gluOrtho2D(GLdouble left, GLdouble right, GLdouble bottom, GLdouble top);

/* WebGL rendering functions */
void WebGLRenderFrame(void);
void WebGLUpdateSimTime(double time);

/* Legacy OpenGL compatibility stubs (not supported in WebGL) */
#define glPushMatrix()      /* No-op in WebGL */
#define glPopMatrix()       /* No-op in WebGL */
#define glLoadIdentity()    /* No-op in WebGL */
#define glMatrixMode(mode)  /* No-op in WebGL */
#define glMultMatrixf(m)    /* No-op in WebGL */
#define glMultMatrixd(m)    /* No-op in WebGL */
#define glTranslatef(x,y,z) /* No-op in WebGL */
#define glTranslated(x,y,z) /* No-op in WebGL */
#define glRotatef(a,x,y,z)  /* No-op in WebGL */
#define glRotated(a,x,y,z)  /* No-op in WebGL */
#define glScalef(x,y,z)     /* No-op in WebGL */
#define glScaled(x,y,z)     /* No-op in WebGL */

/* Legacy lighting (not supported in WebGL - use shaders) */
#define glLightfv(light,pname,params)  /* No-op in WebGL */
#define glLightModelfv(pname,params)   /* No-op in WebGL */
#define glMaterialfv(face,pname,params) /* No-op in WebGL */
#define glMaterialf(face,pname,param)  /* No-op in WebGL */
#define glColorMaterial(face,mode)     /* No-op in WebGL */
#define glShadeModel(mode)             /* No-op in WebGL */
#define glNormalize(mode)              /* No-op in WebGL */

/* Legacy texture environment (use shaders in WebGL) */
#define glTexEnvf(target,pname,param)  /* No-op in WebGL */
#define glTexImage1D(target,level,internal,width,border,format,type,data) /* No-op in WebGL */

/* Legacy drawing buffer */
#define glDrawBuffer(mode)             /* No-op in WebGL */

/* Legacy rasterization */
#define glPointSize(size)              /* No-op in WebGL */
#define glRasterPos2i(x,y)             /* No-op in WebGL */
#define glRasterPos2f(x,y)             /* No-op in WebGL */
#define glRasterPos3f(x,y,z)           /* No-op in WebGL */
#define glRasterPos3d(x,y,z)           /* No-op in WebGL */
#define glRasterPos3dv(v)              /* No-op in WebGL */

/* Legacy GLU quadrics */
#define GLUquadric void
#define gluNewQuadric()                ((void*)0)
#define gluSphere(quad,radius,slices,stacks) /* No-op in WebGL */
#define gluDeleteQuadric(quad)         /* No-op in WebGL */
#define gluErrorString(errCode)        ((const unsigned char*)"GL Error")

/* Legacy projection */
#define glOrtho(l,r,b,t,n,f)           /* No-op in WebGL */

/* Legacy immediate mode rendering (not supported in WebGL) */
#define glBegin(mode)           /* No-op in WebGL */
#define glEnd()                 /* No-op in WebGL */
#define glVertex2i(x,y)         /* No-op in WebGL */
#define glVertex2f(x,y)         /* No-op in WebGL */
#define glVertex2d(x,y)         /* No-op in WebGL */
#define glVertex3f(x,y,z)       /* No-op in WebGL */
#define glVertex3d(x,y,z)       /* No-op in WebGL */
#define glVertex3fv(v)          /* No-op in WebGL */
#define glVertex3dv(v)          /* No-op in WebGL */
#define glVertex4d(x,y,z,w)     /* No-op in WebGL */
#define glVertex4dv(v)          /* No-op in WebGL */
#define glNormal3f(x,y,z)       /* No-op in WebGL */
#define glNormal3d(x,y,z)       /* No-op in WebGL */
#define glNormal3fv(v)          /* No-op in WebGL */
#define glNormal3dv(v)          /* No-op in WebGL */
#define glTexCoord2f(s,t)       /* No-op in WebGL */
#define glTexCoord2d(s,t)       /* No-op in WebGL */
#define glTexCoord2dv(v)        /* No-op in WebGL */
#define glTexCoord3f(s,t,r)     /* No-op in WebGL */
#define glColor3f(r,g,b)        /* No-op in WebGL */
#define glColor3d(r,g,b)        /* No-op in WebGL */
#define glColor4f(r,g,b,a)      /* No-op in WebGL */
#define glColor4d(r,g,b,a)      /* No-op in WebGL */
#define glColor3fv(v)           /* No-op in WebGL */
#define glColor4fv(v)           /* No-op in WebGL */
#define glRasterPos2i(x,y)      /* No-op in WebGL */
#define glRasterPos3f(x,y,z)    /* No-op in WebGL */
#define glRasterPos4dv(v)       /* No-op in WebGL */
#define glBitmap(w,h,xo,yo,xm,ym,bitmap) /* No-op in WebGL */

/* Legacy display lists (not supported in WebGL) */
#define glGenLists(range)       0  /* Return dummy value */
#define glNewList(list,mode)    /* No-op in WebGL */
#define glEndList()             /* No-op in WebGL */
#define glCallList(list)        /* No-op in WebGL */
#define glCallLists(n,type,lists) /* No-op in WebGL */
#define glDeleteLists(list,range) /* No-op in WebGL */
#define glListBase(base)        /* No-op in WebGL */

/* Legacy attribute stack */
#define glPushAttrib(mask)      /* No-op in WebGL */
#define glPopAttrib()           /* No-op in WebGL */

/* Legacy polygon modes */
#define glPolygonMode(face,mode) /* No-op in WebGL */

/* Legacy OpenGL constants */
#ifndef GL_LIGHT0
#define GL_LIGHT0 0x4000
#endif
#ifndef GL_POSITION
#define GL_POSITION 0x1203
#endif
#ifndef GL_MODELVIEW
#define GL_MODELVIEW 0x1700
#endif
#ifndef GL_PROJECTION
#define GL_PROJECTION 0x1701
#endif
#ifndef GL_TEXTURE_1D
#define GL_TEXTURE_1D 0x0DE0
#endif
#ifndef GL_TEXTURE_CUBE_MAP
#define GL_TEXTURE_CUBE_MAP 0x8513
#endif
#ifndef GL_QUADS
#define GL_QUADS 0x0007
#endif
#ifndef GL_POLYGON
#define GL_POLYGON 0x0009
#endif
#ifndef GL_COMPILE
#define GL_COMPILE 0x1300
#endif
#ifndef GL_LIGHTING
#define GL_LIGHTING 0x0B50
#endif
#ifndef GL_SHININESS
#define GL_SHININESS 0x1601
#endif
#ifndef GL_COLOR_MATERIAL
#define GL_COLOR_MATERIAL 0x0B57
#endif
#ifndef GL_EMISSION
#define GL_EMISSION 0x1600
#endif
#ifndef GL_TEXTURE_ENV
#define GL_TEXTURE_ENV 0x2300
#endif
#ifndef GL_TEXTURE_ENV_MODE
#define GL_TEXTURE_ENV_MODE 0x2200
#endif
#ifndef GL_MODULATE
#define GL_MODULATE 0x2100
#endif
#ifndef GL_PROJECTION_MATRIX
#define GL_PROJECTION_MATRIX 0x0BA7
#endif
#ifndef GL_FLAT
#define GL_FLAT 0x1D00
#endif
#ifndef GL_LINE_SMOOTH
#define GL_LINE_SMOOTH 0x0B20
#endif
#ifndef GL_GENERATE_MIPMAP
#define GL_GENERATE_MIPMAP 0x8191
#endif
#ifndef GL_CLAMP
#define GL_CLAMP 0x2900
#endif
#ifndef GL_COMPARE_R_TO_TEXTURE
#define GL_COMPARE_R_TO_TEXTURE 0x884E
#endif
#ifndef GL_DEPTH_COMPONENT32
#define GL_DEPTH_COMPONENT32 0x81A7
#endif
#ifndef GL_NONE
#define GL_NONE 0
#endif
#ifndef GL_NORMALIZE
#define GL_NORMALIZE 0x0BA1
#endif
#ifndef GL_LIST_BIT
#define GL_LIST_BIT 0x00020000
#endif
#ifndef GL_LINE
#define GL_LINE 0x1B01
#endif
#ifndef GL_FILL
#define GL_FILL 0x1B02
#endif
#ifndef GL_MAX_TEXTURE_UNITS_ARB
#define GL_MAX_TEXTURE_UNITS_ARB 0x84E2
#endif

/* GLUT constants */
#ifndef GLUT_BITMAP_HELVETICA_18
#define GLUT_BITMAP_HELVETICA_18 ((void*)7)
#endif
#ifndef GLUT_BITMAP_8_BY_13
#define GLUT_BITMAP_8_BY_13 ((void*)2)
#endif

/* Compatibility macros - redirect GLUT calls to WebGL versions */
#define glutSwapBuffers()           webgl_glutSwapBuffers()
#define glutPostRedisplay()         webgl_glutPostRedisplay()
#define glutSetWindow(w)            webgl_glutSetWindow(w)
#define glutCreateWindow(t)         webgl_glutCreateWindow(t)
#define glutDisplayFunc(f)          webgl_glutDisplayFunc(f)
#define glutReshapeFunc(f)          webgl_glutReshapeFunc(f)
#define glutKeyboardFunc(f)         webgl_glutKeyboardFunc(f)
#define glutMouseFunc(f)            webgl_glutMouseFunc(f)
#define glutMotionFunc(f)           webgl_glutMotionFunc(f)
#define glutIdleFunc(f)             webgl_glutIdleFunc(f)
#define glutTimerFunc(m,f,v)        webgl_glutTimerFunc(m,f,v)
#define glutMainLoop()              webgl_glutMainLoop()
#define gluPerspective(f,a,n,r)     webgl_gluPerspective(f,a,n,r)
#define gluLookAt(ex,ey,ez,cx,cy,cz,ux,uy,uz) webgl_gluLookAt(ex,ey,ez,cx,cy,cz,ux,uy,uz)
#define gluOrtho2D(l,r,b,t)         webgl_gluOrtho2D(l,r,b,t)

#endif /* __WASM__ */

#endif /* __42WEBGL_H__ */
