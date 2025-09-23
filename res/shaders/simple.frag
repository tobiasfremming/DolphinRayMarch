#version 430 core
#define NUM_BOIDS 13
#define KINEMATICS_INDEX 20
#define NUMI 10
#define NUMF 10.0

#define MAX_ITER 5
#define TAU 6.28318530718

#define GOD_RAY_LENGTH 0.9 // higher number = shorter rays
#define GOD_RAY_FREQUENCY 32.0

uniform float iTime;
uniform vec2 iResolution;

struct Boid {
    vec3 position;
    vec3 velocity;
};

layout(std430, binding = 0) buffer BoidBuffer {
    Boid boids[];
};



out vec4 fragColor;


vec3 lightPos = vec3(-2.0, -4.0, -2.0);

float fishTime;
float isJump;
float isJump2;

vec3 ccd, ccp;
int currentIndex;
vec3 repeatIndex;

// Global values for calculating color
vec3 lastFishLocalP;
vec3 lastFishRepeatIndex;
float lastFishScale;

vec3 lastDolphinLocalP;
float lastDolphinSegmentRatio; // for longitudinal variation (0 at head, 1 at tail)

// candidate
vec3 lastFishLocalPCandidate;
vec3 lastFishRepeatIndexCandidate;
float lastFishScaleCandidate;

vec3 lastDolphinLocalPCandidate;
float lastDolphinSegmentRatioCandidate; // for longitudinal variation (0 at head, 1 at tail)



float dot2( in vec2 v ) { return dot(v,v); }
float dot2( in vec3 v ) { return dot(v,v); }
float ndot( in vec2 a, in vec2 b ) { return a.x*b.x - a.y*b.y; }


float rand(vec2 co) { return fract(sin(dot(co.xy, vec2(12.9898,78.233))) * 43758.5453); }

float smoothMin(in float da, in float db, in float k){
    float h = max(k - abs(da - db), 0.0) / k;
    return min(da, db) - h * h * h * k * (1.0 / 6.0);
}

vec3 ditherNormal(vec3 normal, vec2 uv) {
    // Apply a small random offset to the normal based on the UV coordinates
    float ditherAmount = 0.02; // Adjust this value to control the dithering intensity
    vec3 ditheredNormal = normal + ditherAmount * vec3(
        rand(uv + vec2(1.0, 0.0)) - 0.5,
        rand(uv + vec2(0.0, 1.0)) - 0.5,
        rand(uv) - 0.5
    );
    return normalize(ditheredNormal);
}

float expSmoothMin(float a, float b, float k) {
    float res = exp(-k * a) + exp(-k * b);
    return -log(res) / k;
}

float udRoundBox( vec3 p, vec3 b, float r )
{
    return length(max(abs(p)-b,0.0))-r;
}

vec3 rotationFromDirection(vec3 p, vec3 velocity) {
    vec3 forward = -normalize(velocity); // invert because our fish’s nose is along -X.
    
    vec3 up = vec3(0.0, 1.0, 0.0);
    if (abs(dot(forward, up)) > 0.99) {
        up = vec3(1.0, 0.0, 0.0);
    }
    vec3 right = normalize(cross(up, forward));
    // Recompute up to ensure orthonormality.
    up = cross(forward, right);
    
    // Construct a rotation matrix.
    // Here, the fish model is assumed to be modeled in local space with:
    //   - Forward (nose) along -X, Up along Y, Right along Z.
    // We want to rotate p so that model -X aligns with the world-space 'forward'.
    // One way is to form the matrix with columns corresponding to the desired world basis.
    mat3 rot = mat3(forward, up, right);
    
    // Apply the rotation to p.
    return p * rot;
}

// https://iquilezles.org/articles/distfunctions/
float sdVesicaSegment( in vec3 p, in vec3 a, in vec3 b, in float w )
{
    vec3  c = (a+b)*0.5;
    float l = length(b-a);
    vec3  v = (b-a)/l;
    float y = dot(p-c,v);
    vec2  q = vec2(length(p-c-y*v),abs(y));
    
    float r = 0.5*l;
    float d = 0.5*(r*r-w*w)/w;
    vec3  h = (r*q.x<d*(q.y-r)) ? vec3(0.0,r,0.0) : vec3(-d,0.0,d+w);
 
    return length(q-h.xy) - h.z;
}

// https://iquilezles.org/articles/distfunctions/
float udTriangle( vec3 p, vec3 a, vec3 b, vec3 c )
{
  vec3 ba = b - a; vec3 pa = p - a;
  vec3 cb = c - b; vec3 pb = p - b;
  vec3 ac = a - c; vec3 pc = p - c;
  vec3 nor = cross( ba, ac );

  return sqrt(
    (sign(dot(cross(ba,nor),pa)) +
     sign(dot(cross(cb,nor),pb)) +
     sign(dot(cross(ac,nor),pc))<2.0)
     ?
     min( min(
     dot2(ba*clamp(dot(ba,pa)/dot2(ba),0.0,1.0)-pa),
     dot2(cb*clamp(dot(cb,pb)/dot2(cb),0.0,1.0)-pb) ),
     dot2(ac*clamp(dot(ac,pc)/dot2(ac),0.0,1.0)-pc) )
     :
     dot(nor,pa)*dot(nor,pa)/dot2(nor) );
}

vec3 rotate(vec3 v, float angle, vec3 axis)
{
    // Make sure the axis is normalized
    axis = normalize(axis);
    
    float c = cos(angle);
    float s = sin(angle);
    // Rodrigues’ rotation formula
    return v * c + cross(axis, v) * s + axis * dot(axis, v) * (1.0 - c);
}



vec3 animateFish(vec3 p) {
    float waveFrequency = fract(sin(fishTime) * 43758.5453) * 5.0;
    float waveAmplitude = 0.1;

    float nose = 0.0;
    float tail = 0.25; 

    // Tail sway influence: 0.0 at nose, 1.0 at tail
    float factor = clamp((p.x - nose) / (tail - nose), 0.0, 1.0);
    factor = pow(factor, 2.0); // Exponential falloff to limit front movement

    // Apply sine wave deformation toward the Z axis
    p.z += sin(p.x * waveFrequency + (rand(repeatIndex.xy) + iTime) * 10.0) 
         * waveAmplitude * factor;

    p = rotate(p, (sin(p.x * waveFrequency + (rand(repeatIndex.xy) + iTime) * 30.0) * waveAmplitude * factor * 10.0), vec3(1., 0., 0.));


    return p;
}


float sdFish_based(vec3 p) {
    p = animateFish(p);

    float sdV = sdVesicaSegment(p, vec3(-0.012, 0.0, 0.0), vec3(0.178, 0.0, 0.0), 0.032);

    float sdDorsalFin = udTriangle(p, vec3(-0.002, 0.0, 0.0), vec3(0.098, 0.07, 0.0), vec3(0.128, 0.0, 0.0));

    float sdTail = udTriangle(p, vec3(0.178, 0.0, 0.0), vec3(0.228, 0.04, 0.0), vec3(0.228, -0.04, 0.0));
    
    float sdBellyFin = udTriangle(p, vec3(0.018, 0.0, 0.0), vec3(0.088, -0.05, 0.0), vec3(0.108, 0.0, 0.0));

    //float body = min(sdV, sdDorsalFin);
    //body = min(body, sdBellyFin);
    //body = min(body, sdTail);
    float body = smoothMin(sdV, sdDorsalFin, 0.04);
    body = smoothMin(body, sdBellyFin, 0.02);
    body = smoothMin(body, sdTail, 0.02);
    
    return body;
}

float sdFish(vec3 p, float scale){
    float fishSDF = scale * sdFish_based(p / scale);
    float sphereSDF = length(p) - scale * 0.3;
    return max(fishSDF, sphereSDF);
}


vec3 hash3(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.yzx + 33.33);
    return fract((p.xxy + p.yzz) * p.zyx);
}


// based on https://iquilezles.org/articles/sdfrepetition/, but my own logic for jitter and stuff
// Limited Domain Repetition in 3D
// p   : the point in space to evaluate
// s   : repetition period (cell size)
// lim : a vec3 specifying the maximum allowed instance ID (e.g. for a grid of 5 instances in x, lim.x should be 3.0,
//        so that the valid id range is clamped to [-2,2] after subtracting 1)
float limitedDomainRepeatSDF(vec3 p, float s, vec3 lim, vec3 vel) {
    // Compute the base cell ID from p in repeated space
    vec3 id = round(p / s);

    // Determine which side p is relative to the cell center
    vec3 o = sign(p - s * id);
    // Jitter amount relative to the cell size
    float jitterAmount = 0.34;
    
    float d = 1e20;
    
    // Loop over the 2x2x2 neighborhood
    for (int k = 0; k < 2; k++) {
        for (int j = 0; j < 2; j++) {
            for (int i = 0; i < 2; i++) {
                vec3 offset = vec3(float(i), float(j), float(k));
                vec3 rid = id + offset * o;
                rid = clamp(rid, -(lim - vec3(1.0)), lim - vec3(1.0));
                repeatIndex = rid;
                // Compute a jitter offset based on the candidate cell's ID.
                // Using hash3(rid) ensures that adjacent cells vary consistently.
                vec3 cellJitter = (hash3(rid) - 0.5) * jitterAmount;
                // Compute the local coordinate within this candidate cell with jitter
                vec3 r = p - s * (rid + cellJitter);
                vec3 localP = rotationFromDirection(r, vel); // TODO: use time to add some jitter offset
                float scale = 0.5;
                float fishSDF = sdFish(localP, scale);
                
                // Calculate fish color

                if (fishSDF < d) {
                    d = fishSDF;
                    lastFishLocalPCandidate = localP;
                    lastFishRepeatIndexCandidate = rid;
                    lastFishScaleCandidate = scale;
                }
            }
        }
    }
    
    return d;
}



// DOLPHIN ===================================================================================

vec3 calculateDolphinColor(vec3 localP, float spineRatio) {
    return vec3(0.7, 0.6, 0.8); // Placeholder for dolphin color
    // Vertical gradient (Y axis): belly to top
    float bellyBlend = smoothstep(-0.1, 0.05, localP.y);

    vec3 belly = vec3(0.85, 0.85, 0.88);   // silvery gray
    vec3 back  = vec3(0.1, 0.1, 0.15);     // dark steel blue
    vec3 bodyColor = mix(belly, back, bellyBlend);

    float dorsalStripe = smoothstep(0.0, 0.02, abs(localP.z));
    bodyColor = mix(bodyColor, bodyColor * 0.7, dorsalStripe);

    float tailDarken = smoothstep(0.6, 1.0, spineRatio);
    bodyColor *= mix(1.0, 0.75, tailDarken);

    return bodyColor;
}


float sdEllipsoid( in vec3 p, in vec3 r ) 
{
    float k0 = length(p/r);
    float k1 = length(p/(r*r));
    return k0*(k0-1.0)/k1;
}

// https://www.shadertoy.com/view/4sS3zG
vec2 sd2Segment(vec3 start, vec3 end, vec3 point) {
    vec3 startToPoint = point - start;
    vec3 segmentVector = end - start;
    // Project the query point onto the segment vector and clamp it between 0 and 1
    float t = clamp(dot(startToPoint, segmentVector) / dot(segmentVector, segmentVector), 0.0, 1.0);

    vec3 closest = start + t * segmentVector;
    vec3 diff = point - closest;
    // Return squared distance to the segment and the projection factor (t)
    return vec2(dot(diff, diff), t);
}

// https://www.shadertoy.com/view/4sS3zG
vec2 anima( float ih, float t )
{
    float an1 = 0.9*(0.5+0.2*ih)*cos(5.0*ih - 3.0*t + 6.2831/4.0);
    float an2 = 1.0*cos(3.5*ih - 1.0*t + 6.2831/4.0);
    float an = mix( an1, an2, isJump );
    float ro = 0.4*cos(4.0*ih - 1.0*t)*(1.0-0.5*isJump);
	return vec2( an, ro );
}

// https://www.shadertoy.com/view/4sS3zG
vec3 anima2( void )
{
    vec3 a1 = vec3(0.0,        sin(3.0*fishTime+6.2831/4.0),0.0);
    vec3 a2 = vec3(0.0,1.5+2.5*cos(1.0*fishTime),0.0);
	vec3 a = mix( a1, a2, isJump );
	a.y *= 0.5;
	a.x += 0.1*sin(0.1 - 1.0*fishTime)*(1.0-isJump);
    return a;
}

// Based on https://www.shadertoy.com/view/4sS3zG, but changed logic for kinematics and deforming
vec2 sdDolphinKinematic(vec3 p, vec3 vel, vec3 prevVel) {
    
    float lagFactor = 0.4;
    vec3 dirCurr = length(vel) > 0.0 ? -normalize(vel) : normalize(vel);
    vec3 dirPrev = length(prevVel) > 0.0 ? -normalize(prevVel) : dirCurr;
    if (dot(dirPrev, dirCurr) < 0.0) {
        dirPrev = -dirPrev;
    }
    
    //Use smootherstep for blending to avoid sharp transitions
    float blendFactor = smoothstep(0.0, 0.5, dot(dirPrev, dirCurr));
    vec3 blendedDir = normalize(mix(dirPrev, dirCurr, mix(lagFactor, 1.0, 1.0-blendFactor)));
    
    
    vec2 res = vec2(1000.0, 0.0);
    vec3 segmentStart = anima2();
    
    vec3 p1 = segmentStart, p2 = segmentStart, p3 = segmentStart;
    vec3 d1 = vec3(0.0), d2 = vec3(0.0), d3 = vec3(0.0);
    vec3 midpoint = segmentStart;
    
    for(int i = 0; i < NUMI; i++) {
        float ih = float(i) / NUMF;
        vec2 anim = anima(ih, fishTime);
        float ll = (i == 0) ? 0.655 : 0.48;
        
        // Create animation offset with fallback for zero velocity
        vec3 animOffset = length(vel) > 0.0 ? 
            normalize(vec3(sin(anim.y), sin(anim.x), cos(anim.x))) :
            vec3(0.0, 0.1, 1.0);
        
        // Blend directions with ensured validity
        vec3 segmentDir = normalize(mix(blendedDir, animOffset, min(lagFactor * 1.5, 0.9)));
        
        // Ensure segment direction is valid
        if (any(isnan(segmentDir))){ segmentDir = vec3(0.0, 0.0, 1.0);}
        
        vec3 segmentEnd = segmentStart + ll * segmentDir;
        
        vec2 dis = sd2Segment(segmentStart, segmentEnd, p);
        
        if(dis.x < res.x) {
            res = vec2(dis.x, ih + dis.y / NUMF);
            midpoint = mix(segmentStart, segmentEnd, dis.y);
            ccd = segmentEnd - segmentStart;
            
            lastDolphinLocalPCandidate = p;
            lastDolphinSegmentRatioCandidate = ih + dis.y / NUMF;
        }
        
        // Store reference points for fins/tail
        if(i == 3) { p1 = segmentStart; d1 = segmentEnd - segmentStart; }
        if(i == 4) { p3 = segmentStart; d3 = segmentEnd - segmentStart; }
        if(i == (NUMI - 1)) { p2 = segmentEnd; d2 = segmentEnd - segmentStart; }
        
        segmentStart = segmentEnd;
    }
    ccp = midpoint;
    
    // Body SDF
    float h = res.y;
    float ra = 0.05 + h * (1.0 - h) * (1.0 - h) * 2.7;
    ra += 7.0 * max(0.0, h - 0.04) * exp(-30.0 * max(0.0, h - 0.04)) * smoothstep(-0.1, 0.1, p.y - midpoint.y);
    ra -= 0.03 * (smoothstep(0.0, 0.1, abs(p.y - midpoint.y))) * (1.0 - smoothstep(0.0, 0.1, h));
    ra += 0.05 * clamp(1.0 - 3.0 * h, 0.0, 1.0);
    ra += 0.035 * (1.0 - smoothstep(0.0, 0.025, abs(h - 0.1))) * (1.0 - smoothstep(0.0, 0.1, abs(p.y - midpoint.y)));
    
    res.x = 0.75 * (distance(p, midpoint) - ra);
    
    // fin/tail calculations with stability checks
    if(length(d3) > 0.0) {
        // Blend the fin direction with the overall movement direction
        //vec3 finDir = normalize(mix(blendedDir, normalize(d3), lagFactor));
        vec3 finDir = normalize(p3);
        
        // Create rotation matrix with proper up vector handling
        vec3 upRef = abs(dot(finDir, vec3(0.0, 1.0, 0.0))) > 0.99 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
        vec3 right = normalize(cross(upRef, finDir));
        vec3 newUp = cross(finDir, right);
        mat3 finRot = mat3(right, newUp, finDir);
        
        // Transform point to fin space (using transpose for correct transformation)
        vec3 ps = transpose(finRot) * (p - p3);
        ps.z -= 0.4;
        
        // Fin SDF calculations
        float d5 = length(ps.yz) - 0.9;
        d5 = max(d5, -(length(ps.yz - vec2(0.6, 0.0)) - 0.35));
        d5 = max(d5, udRoundBox(ps + vec3(0.0, -0.5, 0.5), vec3(0.0, 0.5, 0.5), 0.02));
        res.x = smoothMin(res.x, d5, 0.1);
    }
    
    if(length(d1) > 0.0) {
        // Blend the fin direction with the overall movement direction
        //vec3 finDir2 = normalize(mix(blendedDir, normalize(d1), lagFactor));
        vec3 finDir2 = normalize(p1);
        
        // Create rotation matrix with proper up vector handling
        vec3 upRefFin2 = abs(dot(finDir2, vec3(0.0, 1.0, 0.0))) > 0.99 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
        vec3 rightFin2 = normalize(cross(upRefFin2, finDir2));
        vec3 newUpFin2 = cross(finDir2, rightFin2);
        mat3 finRot2 = mat3(rightFin2, newUpFin2, finDir2);
        
        // Transform point to fin space (using transpose for correct transformation)
        vec3 finLocal2 = transpose(finRot2) * (p - p1);
        finLocal2.x = abs(finLocal2.x);
        
        // Compute blend factor for fin shape
        float lVal = smoothstep(0.4, 0.9, finLocal2.x);
        lVal *= 1.0 - clamp(5.0 * abs(finLocal2.z + 0.2), 0.0, 1.0);
        
        finLocal2 += vec3(-0.2, 0.36, -0.2);
        float dFin2 = length(finLocal2.xz) - 0.8;
        dFin2 = max(dFin2, -(length(finLocal2.xz - vec2(0.2, 0.4)) - 0.8));
        dFin2 = max(dFin2, udRoundBox(finLocal2, vec3(1.0, 0.0, 1.0), 0.015 + 0.05 * lVal));
        res.x = smoothMin(res.x, dFin2, 0.12);
    }
    
    if(length(d2) > 0.0) {
        // Blend the tail direction with the overall movement direction (less lag for more responsiveness)
        vec3 tailDir = normalize(mix(blendedDir, normalize(d2), 0.8));
        
        // Create rotation matrix with proper up vector handling
        vec3 upRef = abs(dot(tailDir, vec3(0.0, 1.0, 0.0))) > 0.99 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
        vec3 right = normalize(cross(upRef, tailDir));
        vec3 newUp = cross(tailDir, right);
        mat3 tailRot = mat3(right, newUp, tailDir);
        
        // Transform point to tail space (using transpose for correct transformation)
        vec3 tailLocal = transpose(tailRot) * (p - p2 - tailDir * 0.25);
        
        // Tail SDF calculations
        float dTail = length(tailLocal.xz) - 0.6;
        dTail = max(dTail, -(length(tailLocal.xz - vec2(0.0, 0.8)) - 0.9));
        dTail = max(dTail, udRoundBox(tailLocal, vec3(1.0, 0.005, 1.0), 0.005));
        res.x = smoothMin(res.x, dTail, 0.1);
    }
    
    return res;
}

//              NOT CURRENTLY IN USE
//                        |
//                       \|/
//                        V
// Improved kinematics, but cant figure out the fin placement
vec2 sdDolphinKinematicNEWAPPROACH(vec3 p, vec3 vel, vec3 prevVel) {
    // Direction blending (unchanged)
    float lagFactor = 0.4;
    vec3 dirPrev = length(prevVel) > 0.0 ? -normalize(prevVel) : vec3(0.0, 0.0, -1.0);
    vec3 dirCurr = length(vel) > 0.0 ? -normalize(vel) : vec3(0.0, 0.0, -1.0);
    
    float blendFactor = smoothstep(0.0, 0.5, dot(dirPrev, dirCurr));
    vec3 blendedDir = normalize(mix(dirPrev, dirCurr, mix(lagFactor, 1.0, 1.0-blendFactor)));
    
    vec2 res = vec2(1000.0, 0.0);
    vec3 segmentStart = anima2();
    
    // Store all segments for proper body shape and fin placement
    vec3[NUMI] segments;
    vec3[NUMI] segmentDirs;
    vec3 midpoint = segmentStart;
    
    for(int i = 0; i < NUMI; i++) {
        float ih = float(i) / NUMF;
        vec2 anim = anima(ih, fishTime);
        float ll = (i == 0) ? 0.655 : 0.48;
        
        vec3 animOffset = length(vel) > 0.0 ? 
            normalize(vec3(sin(anim.y), sin(anim.x), cos(anim.x))) :
            vec3(0.0, 0.1, 1.0);
        
        vec3 segmentDir = normalize(mix(blendedDir, animOffset, min(lagFactor * 1.5, 0.9)));
        if (any(isnan(segmentDir))) segmentDir = vec3(0.0, 0.0, 1.0);
        
        vec3 segmentEnd = segmentStart + ll * segmentDir;
        
        segments[i] = segmentStart;
        segmentDirs[i] = segmentDir;
        
        vec2 dis = sd2Segment(segmentStart, segmentEnd, p);
        if(dis.x < res.x) {
            res = vec2(dis.x, ih + dis.y / NUMF);
            midpoint = mix(segmentStart, segmentEnd, dis.y);
            ccd = segmentEnd - segmentStart;
            lastDolphinLocalPCandidate = p;
            lastDolphinSegmentRatioCandidate = ih + dis.y / NUMF;
        }
        
        segmentStart = segmentEnd;
    }
    ccp = midpoint;
    
    // RESTORE ORIGINAL DOLPHIN BODY SHAPE
    float h = res.y;
    float ra = 0.05 + h*(1.0-h)*(1.0-h)*2.7;
    // Dolphin-specific shape adjustments
    ra += 7.0*max(0.0,h-0.04)*exp(-30.0*max(0.0,h-0.04)) * smoothstep(-0.1, 0.1, p.y-midpoint.y);
    ra -= 0.03*(smoothstep(0.0, 0.1, abs(p.y-midpoint.y)))*(1.0-smoothstep(0.0,0.1,h));
    ra += 0.05*clamp(1.0-3.0*h,0.0,1.0);
    ra += 0.035*(1.0-smoothstep( 0.0, 0.025, abs(h-0.1) ))* (1.0-smoothstep(0.0, 0.1, abs(p.y-midpoint.y)));
    
    // Main body SDF with proper dolphin shape
    res.x = 0.75 * (distance(p,midpoint) - ra);
    
    // IMPROVED FIN/TAL CALCULATIONS (now properly attached to body)
    
    // Dorsal fin (using segment 4)
    if(NUMI > 4) {
        vec3 finBase = segments[4];
        vec3 segmentDir = segmentDirs[4];
        
        // Calculate segment-aligned rotation
        vec3 segmentRight = normalize(cross(segmentDir, vec3(0,1,0)));
        vec3 segmentUp = normalize(cross(segmentRight, segmentDir));
        mat3 finRot = mat3(segmentRight, segmentUp, segmentDir);
        
        // Transform to fin local space
        vec3 finLocal = finRot * (p - finBase);
        finLocal.z -= 0.4; // Position adjustment
        
        // Dorsal fin SDF
        float dFin = length(finLocal.yz) - 0.9;
        dFin = max(dFin, -(length(finLocal.yz - vec2(0.6, 0.0)) - 0.35));
        dFin = max(dFin, udRoundBox(finLocal + vec3(0.0, -0.5, 0.5), vec3(0.0, 0.5, 0.5), 0.02));
        res.x = smoothMin(res.x, dFin, 0.1);
    }
    
    // Pectoral fins (segment 3)
    if(NUMI > 3) {
        vec3 finBase = segments[3];
        vec3 segmentDir = segmentDirs[3];
        
        // Calculate segment-aligned rotation
        vec3 segmentRight = normalize(cross(segmentDir, vec3(0,1,0)));
        vec3 segmentUp = normalize(cross(segmentRight, segmentDir));
        mat3 finRot = mat3(segmentRight, segmentUp, segmentDir);
        
        // Transform to fin local space
        vec3 finLocal = finRot * (p - finBase);
        finLocal.x = abs(finLocal.x); // Mirror for both fins
        
        // Pectoral fin SDF
        float lVal = smoothstep(0.4, 0.9, finLocal.x);
        lVal *= 1.0 - clamp(5.0 * abs(finLocal.z + 0.2), 0.0, 1.0);
        
        finLocal += vec3(-0.2, 0.36, -0.2); // Fin position offset
        
        float dFin = length(finLocal.xz) - 0.8;
        dFin = max(dFin, -(length(finLocal.xz - vec2(0.2, 0.4)) - 0.8));
        dFin = max(dFin, udRoundBox(finLocal, vec3(1.0, 0.0, 1.0), 0.015 + 0.05 * lVal));
        res.x = smoothMin(res.x, dFin, 0.12);
    }
    
    // Tail (last segment)
    if(NUMI > 1) {
        vec3 tailBase = segments[NUMI-1];
        vec3 segmentDir = segmentDirs[NUMI-1];
        
        // Calculate segment-aligned rotation
        vec3 segmentRight = normalize(cross(segmentDir, vec3(0,1,0)));
        vec3 segmentUp = normalize(cross(segmentRight, segmentDir));
        mat3 tailRot = mat3(segmentRight, segmentUp, segmentDir);
        
        // Transform to tail local space
        vec3 tailLocal = tailRot * (p - tailBase - segmentDir * 0.25);
        
        // Tail SDF
        float dTail = length(tailLocal.xz) - 0.6;
        dTail = max(dTail, -(length(tailLocal.xz - vec2(0.0, 0.8)) - 0.9));
        dTail = max(dTail, udRoundBox(tailLocal, vec3(1.0, 0.005, 1.0), 0.005));
        res.x = smoothMin(res.x, dTail, 0.1);
    }
    
    return res;
}


vec2 fishBound(vec3 p) {
    float d = 1e10;

    float renderIndex = 0.0;
    // Adjust this radius so it tightly bounds your fish.
    float boundingRadius = 2.4; // make this smaller
        
    vec3 pos = boids[0].position;
    // Compute SDF for a sphere centered at pos.
    float sphereSDF = length(p - pos) - boundingRadius;

    if (sphereSDF < 0.01) {
        // p is inside the sphere, so we now do the more expensive evaluation.
        vec3 vel = boids[0].velocity;
        vec3 prevVel = boids[1].velocity;
        vec3 localP = p - pos;  // translate into boid's space
        float dolphin_scale = 0.3;
        
        float fishSDF = dolphin_scale * sdDolphinKinematic(localP/dolphin_scale, vel,  prevVel).x;
        
        if (fishSDF < d) {
            d = fishSDF;
            renderIndex = 1.0;
            vec3 lastFishLocalP;

            lastDolphinLocalP = lastDolphinLocalPCandidate;
            lastDolphinSegmentRatio = lastDolphinSegmentRatioCandidate;
        }
    } 

    boundingRadius = 0.5;
    for (int i = 2; i < NUM_BOIDS; i++) {  // start from 2 to skip the dolphin
        currentIndex = i;
        vec3 pos = boids[i].position;
        float sphereSDF = length(p - pos) - boundingRadius;
        
        if (sphereSDF < 0.01) {
            vec3 vel = boids[i].velocity;
            vec3 localP = p - pos;  // translate into boid's space
            rotationFromDirection(localP, vel);
            
            float fishSDF = limitedDomainRepeatSDF(localP, 0.5, vec3(1.4), vel);
     
            if (fishSDF < d) {
                d = fishSDF;
                renderIndex = 2.0;
                lastFishLocalP = lastFishLocalPCandidate;
                lastFishRepeatIndex = lastFishRepeatIndexCandidate;
                lastFishScale = lastFishScaleCandidate;
            }
            
        } else {
            d = min(d, sphereSDF);
        }
    }
    
    return vec2(d, renderIndex);
}


// NOISE =====================================================================================

float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);

    // Bilinear interpolation
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));

    vec2 u = f * f * (3.0 - 2.0 * f); // smoothstep

    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
    float value = 0.0;
    float amplitude = 0.5;
    float frequency = 1.0;

    for (int i = 0; i < 5; i++) {
        value += amplitude * noise(p * frequency);
        frequency *= 2.0;
        amplitude *= 0.5;
    }

    return value;
}


float warpedFbm(vec2 p) {
    vec2 q = vec2(fbm(p + vec2(1.7, 9.2)),
                  fbm(p + vec2(8.3, 2.8)));

    return fbm(p + 2.0 * q);
}

vec2 terrain(vec3 p) {
    float baseHeight = p.y + 1.5;

    // Macro amplitude shaping
    float macro = fbm(p.xz * 0.15);           // slow macro undulation
    
    float macroHeight = mix(0.0, 2.5, macro); // varying terrain "scale"

    // Mid-frequency detail hills and ridges
    float ridges = abs(sin(p.x * 0.3) * sin(p.z * 0.3));  // simple repeating ridges
    float ridgeHeight = 0.3 * ridges;

    // Mountain height: large, blocky terrain from low-freq FBM
    float mountains = pow(fbm(p.xz * 0.07 + vec2(5.0)), 1.8); // steeper features
    float mountainHeight = 1.4 * mountains + noise(p.xz * 0.5); // add some noise for roughness

    // Combine terrain components
    float finalHeight =
        macroHeight *
        (0.4 * warpedFbm(p.xz * 1.5 + iTime * 0.02) +  // small detail
         ridgeHeight +
         mountainHeight - fbm(p.xz) * 0.002); // large detail

    return vec2(baseHeight + finalHeight, 3.0);
}

vec2 terrainBound(vec3 p) {
    if (p.y < -0.3) {
        return terrain(p);
    }
    return vec2(1000000., 0.0);
}



vec2 map(vec3 p){
    //return the vec2 with lowest x value
    vec2 fishSDF = fishBound(p);
    vec2 terrainSDF = terrainBound(p);

    if (fishSDF.x < terrainSDF.x) {
        return fishSDF;
    }
    else {
        return terrainSDF;
    }

}

// LIGHTING ==========================================================

// https://iquilezles.org/articles/rmshadows/
float softShadow(vec3 ro, vec3 rd, float k) {
    float res = 1.0;
    float t = 0.02; // start distance to skip self-shadowing
    for (int i = 0; i < 24; i++) {
        float h = map(ro + rd * t).x;
        if (h < 0.001) return 0.0; // fully in shadow
        res = min(res, k * h / t);
        t += clamp(h, 0.01, 0.3); // adaptive stepping
        if (t > 10.0) break;
    }
    return clamp(res, 0.0, 1.0);
}

// took some inspiration from https://www.shadertoy.com/view/4sS3zG
vec3 doLighting(vec3 pos, vec3 normal, vec3 viewDir, float gloss, float gloss2, float shadows, vec3 baseColor, float ao) {
    vec3 lightDir = normalize(lightPos); // your global lightPos is fine
    vec3 halfVec = normalize(lightDir - viewDir);
    vec3 refl = reflect(viewDir, normal);

    float sky     = clamp(normal.y, 0.0, 1.0);
    float ground  = clamp(-normal.y, 0.0, 1.0);
    float diff    = max(dot(normal, lightDir), 0.0);
    float back    = max(0.3 + 0.7 * dot(normal, -vec3(lightDir.x, 0.0, lightDir.z)), 0.0);
    float fresnel = pow(1.0 - dot(viewDir, normal), 5.0);
    float spec    = pow(max(dot(halfVec, normal), 0.0), 32.0 * gloss);
    float sss     = pow(1.0 + dot(normal, viewDir), 2.0);
    float shadowFactor = softShadow(pos + normal * 0.01, lightDir, 16.0);

    vec3 brdf = vec3(0.0);
    brdf += 20.0 * diff * vec3(1.00, 0.75, 0.55) * shadowFactor;
    brdf += 5.0  * sky  * vec3(0.20, 0.45, 0.6) * (0.5 + 0.5 * ao);
    brdf += 1.0  * back * vec3(0.40, 0.6, 0.8);
    brdf += 5.0  * ground * vec3(0.1, 0.2, 0.15);
    brdf += 4.0  * sss  * vec3(0.3, 0.3, 0.35) * gloss * ao;
    brdf += 1.5  * spec * vec3(1.2, 1.1, 1.0) * shadowFactor * fresnel * gloss;

    return baseColor * brdf;
}




vec3 calculateFishColor(vec3 localP, float scale) {

    localP = animateFish(localP);
    float minY = -0.05 * scale; // lower bound of fish geometry
    float maxY =  0.05 * scale; // upper bound of fish geometry
    float normY = clamp((localP.y - minY) / (maxY - minY), 0.0, 1.0);

    // Define thresholds in the normalized [0, 1] range.
    float bellyThreshold = 0.4; // below this, the fish is completely belly (white)
    float backThreshold  = 0.8; // above this, the fish's back is fully orange (with darker orange near the spine)

    // Gradually blend from pure belly to orange.
    float bellyTop = -0.5;
    float bellyGradient = smoothstep(0.0, bellyThreshold, normY);
    // For the orange gradient, let the color darken from light to dark orange.
    float orangeGradient = smoothstep(bellyThreshold, backThreshold, normY);


    vec3 bellyColor   = vec3(0.98); // nearly pure white belly.
    vec3 lightOrange  = vec3(1.0, 0.8, 0.6) + lastFishRepeatIndex * 0.5;
    vec3 darkOrange   = vec3(0.4, 0.1, 0.0)* 0.5 + lastFishRepeatIndex * 0.25;
    vec3 orangeColor  = mix(lightOrange, darkOrange, orangeGradient);

    // Blend belly and orange colors.
    vec3 baseColor = mix(bellyColor, orangeColor, bellyGradient);


    float stripeStrength = smoothstep(bellyTop, bellyTop + 0.1 * scale, localP.y);
    float stripeFreq = 100.0;
    // Use fbm to create a small warping offset; scaling it to keep the displacement subtle.
    float warp = fbm(localP.xz * 10.0) * 0.3;
    // Perturb the x-coordinate with the warp for a more organic stripe placement.
    float stripePattern = sin((localP.x + warp) * stripeFreq + localP.z);
    // Use smoothstep to sharply delineate stripe edges, based on the altered stripe pattern.
    float stripeMask = smoothstep(0.65, 0.25, abs(stripePattern));
    // The stripe color remains black.
    vec3 stripeColor = vec3(0.0);
    // Blend the stripes into your base color.
    baseColor = mix(baseColor, stripeColor, stripeMask * stripeStrength);


    float spotNoise = fbm(localP.xz * 10.0);
    float spotMask = smoothstep(0.8, 0.85, spotNoise);
    vec3 spotColor = vec3(0.0, 0.0, 0.0);
    baseColor = mix(baseColor, spotColor, spotMask * 0.5);

    return clamp(baseColor, 0.0, 1.0);
}





vec3 getObjectColor(float renderIndex, vec3 position, vec3 normal) {
    // Compute directional lighting influence (if needed later)
    vec3 up = vec3(0.0, 1.0, 0.0);
    float facingUp = dot(normal, up);

    float noiseVal = fbm(position.xz * 1.5);

    // Define a set of colors for a tropical ocean scene
    vec3 sand   = vec3(0.5, 0.77, 0.60) * 0.5;  // Soft sandy color
    vec3 dirt   = vec3(0.6, 0.2, 0.08)   * 0.4;  // Muted brown
    vec3 moss   = vec3(0.2, 1.0, 0.4)    * 0.3;  // Lush green
    vec3 coral  = vec3(1.0, 0.4, 0.6)    * 0.4;  // Subtle coral pink
    vec3 ocean  = vec3(0.0, 0.5, 0.7)    * 0.4;  // Vibrant blue-green

    // Choose colors based on ranges of noiseVal and blend with smooth transitions
    if (noiseVal < 0.3) {
         // Lower noise values give you the sand areas
         return sand;
    } else if (noiseVal < 0.45) {
         // Transition from sand to dirt
         float factor = smoothstep(0.3, 0.45, noiseVal);
         return mix(sand, dirt, factor);
    } else if (noiseVal < 0.6) {
         // Transition from dirt to moss
         float factor = smoothstep(0.45, 0.6, noiseVal);
         return mix(dirt, moss, factor);
    } else if (noiseVal < 0.75) {
         // Transition from moss to coral
         float factor = smoothstep(0.6, 0.75, noiseVal);
         return mix(moss, coral, factor);
    } else {
         // Transition from coral to ocean for the highest noise values
         float factor = smoothstep(0.75, 0.9, noiseVal);
         return mix(coral, ocean, factor);
    }
    
    return vec3(1.0); // fallback white
}





vec3 calculate_normal(in vec3 p)
{
    const vec3 small_step = vec3(0.001, 0.0, 0.0);

    float gradient_x = map(p + small_step.xyy).x - map(p - small_step.xyy).x;
    float gradient_y = map(p + small_step.yxy).x - map(p - small_step.yxy).x;
    float gradient_z = map(p + small_step.yyx).x - map(p - small_step.yyx).x;

    vec3 normal = vec3(gradient_x, gradient_y, gradient_z);

    return normalize(normal);
}

// https://www.shadertoy.com/view/XdyfR1 Straight up a shameful copy
float GodRays(  in vec2 ndc, in vec2 uv) {
    vec2 godRayOrigin = ndc + vec2(-1.15, -1.25);
    float rayInputFunc = atan(godRayOrigin.y, godRayOrigin.x) * 0.63661977236; // that's 2/pi
    float light = (sin(rayInputFunc * GOD_RAY_FREQUENCY + iTime * -2.25) * 0.5 + 0.5);
    light = 0.5 * (light + (sin(rayInputFunc * 13.0 + iTime) * 0.5 + 0.5));
    light *= pow(clamp(dot(normalize(-godRayOrigin), normalize(ndc - godRayOrigin)), 0.0, 1.0), 2.5);
    light *= pow(uv.y, GOD_RAY_LENGTH);
    light = pow(light, 1.75);
    return light;
}

float causticsPattern(vec3 worldPos) {
    float time = iTime * 0.5 + 23.0;
    vec2 uv = worldPos.xz * 0.5; 
    vec2 p = mod(uv * TAU, TAU) - 250.0;
    vec2 i = p;

    float c = 1.0;
    float inten = 0.005;

    for (int n = 0; n < MAX_ITER; n++) {
        float t = time * (1.0 - (3.5 / float(n + 1)));
        i = p + vec2(
            cos(t - i.x) + sin(t + i.y),
            sin(t - i.y) + cos(t + i.x)
        );
        c += 1.0 / length(vec2(
            p.x / (sin(i.x + t) / inten),
            p.y / (cos(i.y + t) / inten)
        ));
    }

    c /= float(MAX_ITER);
    c = 1.17 - pow(c, 1.4);
    return clamp(pow(abs(c), 8.0), 0.0, 1.0);
}


float generateCaustics(vec3 position) {
    vec2 coord = position.xz * 0.5;
    vec2 tileCoord = mod(coord * TAU, TAU) - 250.0;
    vec2 warp = tileCoord;

    float accum = 1.0;
    float strength = 0.005;
    float phase = iTime * 0.5 + 23.0;

    for (int i = 0; i < MAX_ITER; ++i) {
        float speed = phase * (1.0 - (3.5 / float(i + 1)));

        warp = tileCoord + vec2(
            sin(warp.y + speed) + cos(warp.x - speed),
            cos(warp.x + speed) + sin(warp.y - speed)
        );

        vec2 denom = vec2(
            sin(warp.x + speed) / strength,
            cos(warp.y + speed) / strength
        );

        accum += 1.0 / length(tileCoord / denom);
    }

    accum /= float(MAX_ITER);
    float bright = 1.15 - pow(accum, 1.45);
    return clamp(pow(abs(bright), 7.5), 0.0, 1.0);
}


float drawParticle(vec2 uv, vec2 center, float radius) {
    float d = length(uv - center);
    return exp(-pow(d / radius, 2.0) * 8.0); // soft glow falloff
}


vec4 rayMarch(in vec3 ro, in vec3 rd, in vec2 uv, in vec2 uv2){
    
    int numSteps = 64;
    float threshold = 0.001;
    float distanceTraveled = 0.0;
    float radius = 1000000.0;
    const float MAXIMUM_TRACE_DISTANCE = 1000.0;
    vec3 lightPosition = lightPos;
    vec3 background = mix(vec3(0.1, 0.3, 0.5)*0.8, vec3(0.788, 0.956, 1.0), uv.y*0.5);
    
    while(distanceTraveled < MAXIMUM_TRACE_DISTANCE){
    
        vec3 current_position = ro + distanceTraveled * rd;
        vec2 mapping = map(current_position);
        radius = mapping.x;
        float renderIndex = mapping.y;
        
        if (radius < threshold * distanceTraveled){
            // hit
            vec3 color = vec3(0.0, 0.0, 0.0);
            vec3 normal = calculate_normal(current_position);
            normal = ditherNormal(normal, uv); // dither normal to make it look smoother



            vec3 baseColor = vec3(1.0, 1.0, 1.0);
            if (renderIndex == 1.0) {
                baseColor = calculateDolphinColor(lastDolphinLocalP, lastDolphinSegmentRatio);
            }
            else if (renderIndex == 2.0) {
                baseColor = calculateFishColor(lastFishLocalP, lastFishScale);
            }
            else {
                baseColor = getObjectColor(renderIndex, current_position, normal);
            }
            color = baseColor;
            
            vec3 direction_to_light = normalize(current_position - lightPosition);
                        
            float caustics = generateCaustics(current_position);
            
            caustics = pow(caustics, 0.5);  
        
            float normalFactor = clamp((dot(normal, vec3(0.0, 1.0, 0.0)) + 0.3) / 1.3, 0.0, 1.0);
            color *= caustics* normalFactor;
     
            vec3 viewDir = normalize(ro - current_position);

            float gloss = 1.5;     // Scene shininess
            float gloss2 = 10.4;     // Optional reflection boost
            float ao = 1.0;         // Ambient occlusion placeholder
            float shadows = 0.0; 
            vec3 lightDirection = normalize(lightPosition - current_position);
            //float shadowFactor = softShadow(current_position + normal * 0.01, lightDirection, 16.0);

            color = doLighting(current_position, normal, viewDir, gloss, gloss2, shadows, color, ao);
            float fogDistance = 0.4;
            // // Vlumetric fog (approximate) 
            if (renderIndex == 3.0) {
                
                float godrays = GodRays(uv, uv2);
                vec3 lightColor = mix(vec3(0.5, 1.0, 0.8), vec3(0.55, 0.55, 0.95) * 0.75, 1.0 - uv.y);
                background = mix(background, lightColor, (godrays + 0.05)/1.05);  
                fogDistance = 0.3;
            }
            float fogAmount = 1.0 - exp(-pow(distanceTraveled * fogDistance, 1.1));

            color = mix(color, background, fogAmount);
            return vec4(color, 1.);
            
        }
        
        distanceTraveled += radius;
    
    }
    float godrays = GodRays(uv, uv2);
    vec3 lightColor = mix(vec3(0.5, 1.0, 0.8), vec3(0.55, 0.55, 0.95) * 0.75, 1.0 - uv.y);
    
    // Blend the godrays (scattered light) with the scene color.
    background = mix(background, lightColor, (godrays + 0.05)/1.05);

    vec3 finalColor = background;
    finalColor = clamp(finalColor, 0.0, 1.0);
 
    return vec4(finalColor,1.);

}


void main()
{
    vec2 uv = (2.0 * gl_FragCoord.xy - iResolution.xy) / iResolution.y;
    fishTime = 0.6 + 2.0*iTime;
    

    // Used mouse in shadertoy, do not to it anymore, but too lazy to change names
    vec3 iMouse = vec3(0.0, 0.0, 0.0);
    vec2 mouse = (iMouse.z > 0.0) ? iMouse.xy : 0.5 * iResolution.xy; 
    
    // convert to yaw and pitch
    float sensitivity = 0.03;
    vec2 mouseDelta = mouse - 0.5 * iResolution.xy;
    float yaw   =  sensitivity * mouseDelta.x;
    float pitch = -sensitivity * mouseDelta.y;
    pitch = clamp(pitch, -1.57, 1.57);
    
    
    
    // =======================================================
    // Orbit camera
    // =======================================================
    float radius = 2.0;             // how far from origin
    vec3 target = vec3(0.0, 0.0, 0.0);
    
    // Camera direction from angles (spherical coords)
    vec3 lookDir = normalize(vec3(
        cos(pitch)*sin(yaw),
        sin(pitch),
        cos(pitch)*cos(yaw)
    ));

    

    // Camera position
    vec3 sway = vec3(1.0 * cos(iTime * 0.2), 0.02 * sin(iTime* 0.2), 0.001 * cos(iTime* 0.2));
    vec3 ro = target + sway + radius * lookDir;
    
    // Forward = direction from camera to target
    vec3 forward = normalize(target - ro);

    // worldUp = (0,1,0), then derive right & up for the camera
    vec3 worldUp = vec3(0.0, 1.0, 0.0);
    vec3 right   = normalize(cross(forward, worldUp));
    vec3 up      = cross(right, forward);
    
    vec3 rd = normalize(forward + uv.x * right + uv.y * up);

    vec4 result = rayMarch(ro, rd, uv, gl_FragCoord.xy/iResolution.xy);
    
    vec3 particleColor1 = vec3(0.2, 0.45, 0.1); // deeper green-brown
    vec3 particleColor2 = -vec3(-0.2, 0.4, 0.4);   // slightly lighter variation

    float particleOverlay = 0.0;
    vec3 particles = vec3(0.0);

    int NUM_PARTICLES = 200;
    for (int i = 0; i < NUM_PARTICLES; ++i) {
        float id = float(i);

        // Particle base position and offset
        float speed = 0.03 + 0.015 * sin(id);
        vec2 basePos = vec2(
            fract(sin(id * 73.1) * 43758.5453 + iTime * speed),
            fract(sin(id * 91.3) * 12345.678 + iTime * speed * 0.5)
        );
        basePos.x += 0.02 * sin(iTime * 2.0 + id); // sine wave drift

        // Particle size and alpha depth blending factor
        float size = 0.004+ 0.005 * fract(sin(id * 13.37) * 123.45);
        float alpha = 0.3 + 0.7 * fract(sin(id * 45.12) * 789.23); // blend factor (for "depth")

        // Blend between two colors
        vec3 color = mix(particleColor1, particleColor2, fract(sin(id * 11.7) * 897.2));
        
        // Particle glow
        float glow = drawParticle(gl_FragCoord.xy / iResolution.xy, basePos, size)*0.5;
        particles += alpha * glow * color;
    }

    // Glow pulse from small animals
    
    if (fract(sin( uv.x * 45.1 + iTime * 4.0 + uv.y) * 1234.56) > 0.99995) {
        result += vec4(0.4, 0.7, 0.6, 0.0); // aqua glow
    }
    fragColor = vec4(result + vec4(particles, 0.0));

}

