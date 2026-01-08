/*    This file is distributed with 42,                               */
/*    the (mostly harmless) spacecraft dynamics simulation            */
/*    created by Eric Stoneking of NASA Goddard Space Flight Center   */

/*    Copyright 2010 United States Government                         */
/*    as represented by the Administrator                             */
/*    of the National Aeronautics and Space Administration.           */

/*    No copyright is claimed in the United States                    */
/*    under Title 17, U.S. Code.                                      */

/*    All Other Rights Reserved.                                      */

/* Redis Publishing Module for 42 Spacecraft Simulator                */

extern "C" {
#include "42.h"
}

#include <string>
#include <sstream>
#include <iomanip>
#include <hiredis/hiredis.h>

static redisContext *redisCtx = NULL;

/* Helper function to write a 3D vector to JSON string */
void writeVector3(std::string &buffer, const char* name, double v[3]) {
    std::ostringstream oss;
    oss << std::setprecision(17);
    oss << "\"" << name << "\":{\"x\":" << v[0] << ",\"y\":" << v[1] << ",\"z\":" << v[2] << "}";
    buffer += oss.str();
}

/* Helper function to write a 4D vector (quaternion) to JSON string */
void writeVector4(std::string &buffer, const char* name, double v[4]) {
    std::ostringstream oss;
    oss << std::setprecision(17);
    oss << "\"" << name << "\":{\"x\":" << v[0] << ",\"y\":" << v[1]
        << ",\"z\":" << v[2] << ",\"w\":" << v[3] << "}";
    buffer += oss.str();
}

/* Helper function to write a 3x3 matrix to JSON string */
void writeMatrix3(std::string &buffer, const char* name, double m[3][3]) {
    std::ostringstream oss;
    oss << std::setprecision(17);
    oss << "\"" << name << "\":["
        << m[0][0] << "," << m[0][1] << "," << m[0][2] << ","
        << m[1][0] << "," << m[1][1] << "," << m[1][2] << ","
        << m[2][0] << "," << m[2][1] << "," << m[2][2] << "]";
    buffer += oss.str();
}

/* Helper function to write Keplerian orbital elements to JSON */
void writeKeplerianElements(std::string &buffer, struct OrbitType *O) {
    std::ostringstream oss;
    oss << std::setprecision(17);
    oss << "\"keplerian\":{"
        << "\"n\":" << O->Period << ","
        << "\"e\":" << O->ecc << ","
        << "\"i\":" << O->inc << ","
        << "\"ta\":" << O->anom << ","
        << "\"RAAN\":" << O->RAAN << ","
        << "\"ArgP\":" << O->ArgP << ","
        << "\"SMA\":" << O->SMA << ","
        << "\"h_p\":" << O->rmin
        << "}";
    buffer += oss.str();
}

/* Publish spacecraft state data to Redis */
void PublishRedis(void) {
    if (!redisCtx) {
        redisCtx = redisConnect(PublisherIp, PublisherPort);
        if (redisCtx == NULL || redisCtx->err) {
            if (redisCtx) {
                fprintf(stderr, "Redis connection error: %s\n", redisCtx->errstr);
                redisFree(redisCtx);
                redisCtx = NULL;
            } else {
                fprintf(stderr, "Redis connection error: can't allocate redis context\n");
            }
            return;
        }
    }

    /* Convert SimTime to milliseconds since Unix epoch (approx) */
    /* J2000 epoch is 2000-01-01T12:00:00, Unix epoch is 1970-01-01T00:00:00 */
    /* Difference is approximately 946728000 seconds */
    long long epochMs = (long long)((DynTime + 946728000.0) * 1000.0);

    /* Publish state for each spacecraft */
    for (long Isc = 0; Isc < Nsc; Isc++) {
        struct SCType *S = &SC[Isc];
        struct OrbitType *O = &Orb[S->RefOrb];

        std::string payload;
        std::ostringstream oss;
        oss << std::setprecision(17);

        /* Build JSON payload */
        payload = "{\"epoch\":" + std::to_string(epochMs) + ",";

        /* OCI (Orbit-Centered Inertial) frame data */
        payload += "\"OCI\":{\"cartesian\":{";
        writeVector3(payload, "r", S->PosN);
        payload += ",";
        writeVector3(payload, "v", S->VelN);
        payload += ",";
        writeVector3(payload, "s", S->svn);
        payload += ",";
        writeVector3(payload, "b", S->bvn);
        payload += "},";
        writeKeplerianElements(payload, O);
        payload += "},";

        /* HCI (Helio-Centered Inertial) frame data */
        payload += "\"HCI\":{\"cartesian\":{";
        writeVector3(payload, "r", S->PosH);
        payload += ",";
        writeVector3(payload, "v", S->VelH);
        payload += "}},";

        /* DCMs (Direction Cosine Matrices) */
        payload += "\"DCMs\":{";
        writeMatrix3(payload, "CFN", S->B[0].CN);
        payload += ",";
        writeMatrix3(payload, "CLN", O->CLN);
        payload += "},";

        /* Body data */
        payload += "\"bodies\":[";
        for (long Ib = 0; Ib < S->Nb; Ib++) {
            if (Ib > 0) payload += ",";
            payload += "{";
            writeVector3(payload, "r", S->B[Ib].pn);
            payload += ",";
            writeVector4(payload, "q", S->B[Ib].qn);
            payload += "}";
        }
        payload += "]}";

        /* Build channel name */
        std::string channel = "fortytwo:astrodynamics:spacecraft:" +
                             std::string(S->Label) + ":state:current";

        /* Publish to Redis */
        redisReply *reply = (redisReply*)redisCommand(redisCtx,
                                                      "PUBLISH %s %s",
                                                      channel.c_str(),
                                                      payload.c_str());
        if (reply == NULL) {
            fprintf(stderr, "Redis publish error: %s\n", redisCtx->errstr);
            redisFree(redisCtx);
            redisCtx = NULL;
            return;
        }
        freeReplyObject(reply);

        /* Also SET the key for persistence */
        reply = (redisReply*)redisCommand(redisCtx,
                                         "SET %s %s",
                                         channel.c_str(),
                                         payload.c_str());
        if (reply) freeReplyObject(reply);
    }

    /* Publish orbit state data */
    for (long Io = 0; Io < Norb; Io++) {
        struct OrbitType *O = &Orb[Io];
        if (!O->Exists) continue;

        std::string payload;
        payload = "{\"epoch\":" + std::to_string(epochMs) + ",";

        payload += "\"OCI\":{\"cartesian\":{";
        writeVector3(payload, "r", O->PosN);
        payload += ",";
        writeVector3(payload, "v", O->VelN);
        payload += "},";
        writeKeplerianElements(payload, O);
        payload += "}}";

        std::ostringstream channelStream;
        channelStream << "fortytwo:astrodynamics:orbits:Orb" << Io << ":state:current";
        std::string channel = channelStream.str();

        redisReply *reply = (redisReply*)redisCommand(redisCtx,
                                                      "PUBLISH %s %s",
                                                      channel.c_str(),
                                                      payload.c_str());
        if (reply) {
            freeReplyObject(reply);
            reply = (redisReply*)redisCommand(redisCtx, "SET %s %s",
                                             channel.c_str(), payload.c_str());
            if (reply) freeReplyObject(reply);
        }
    }

    /* Publish world state data */
    for (long Iw = 0; Iw < NWORLD; Iw++) {
        struct WorldType *W = &World[Iw];
        if (!W->Exists) continue;

        std::string payload;
        payload = "{\"epoch\":" + std::to_string(epochMs) + ",";

        payload += "\"HCI\":{\"cartesian\":{";
        writeVector3(payload, "r", W->PosH);
        payload += "}},";

        payload += "\"DCMs\":{";
        writeMatrix3(payload, "CWN", W->CWN);
        payload += "},";

        std::ostringstream oss;
        oss << std::setprecision(17);
        oss << "\"PriMerAng\":" << W->PriMerAng;
        payload += oss.str();
        payload += "}";

        std::string channel = "fortytwo:astrodynamics:worlds:" +
                             std::string(W->Name) + ":state:current";

        redisReply *reply = (redisReply*)redisCommand(redisCtx,
                                                      "PUBLISH %s %s",
                                                      channel.c_str(),
                                                      payload.c_str());
        if (reply) {
            freeReplyObject(reply);
            reply = (redisReply*)redisCommand(redisCtx, "SET %s %s",
                                             channel.c_str(), payload.c_str());
            if (reply) freeReplyObject(reply);
        }
    }
}

/* Main publishing function called from 42exec */
extern "C" void Publish(void) {
    if (strcmp(PublisherType, "Redis") == 0) {
        PublishRedis();
    }
}

/* Cleanup Redis connection on exit */
extern "C" void CleanupRedis(void) {
    if (redisCtx) {
        redisFree(redisCtx);
        redisCtx = NULL;
    }
}
