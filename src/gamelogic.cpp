#include <chrono>
#include <GLFW/glfw3.h>
#include <glad/glad.h>
#include <SFML/Audio/SoundBuffer.hpp>
#include <utilities/shader.hpp>
#include <glm/vec3.hpp>
#include <iostream>
#include <utilities/timeutils.h>
#include <SFML/Audio/Sound.hpp>
#include <glm/gtc/matrix_transform.hpp>
#include <glm/gtc/type_ptr.hpp>
#include <fmt/format.h>
#include "gamelogic.h"
#include "sceneGraph.hpp"
#define GLM_ENABLE_EXPERIMENTAL
#include <glm/gtx/transform.hpp>

#include "utilities/imageLoader.hpp"
#include "utilities/glfont.h"

enum KeyFrameAction {
    BOTTOM, TOP
};

struct Boid {
    glm::vec3 position;
    glm::vec3 velocity;
};



constexpr int NUM_BOIDS = 20; // Number of boids in the simulation
//std::vector<Boid> boids(NUM_BOIDS);

struct GPUBoid {
    glm::vec3 position;
    glm::vec3 velocity;
};
std::vector<GPUBoid> boids(NUM_BOIDS);


#include <timestamps.h>

unsigned int currentKeyFrame = 0;
unsigned int previousKeyFrame = 0;

// TEXTURES
GLuint computeProgram;   // Compute shader program
GLuint ssbo;  // global SSBO handle
GLuint ssboPosition;
GLuint ssboVelocity;

unsigned int framebuffer;
unsigned int textureColorBuffer;


// UNIFORMS
GLint u_time = -1;
GLint u_resolution = -1;
GLint u_texture = -1;

GLint posLoc = -1;
GLint velLoc = -1;

// These are heap allocated, because they should not be initialised at the start of the program
sf::SoundBuffer* buffer;
Gloom::Shader* shader;
Gloom::Shader* shader_compute;
sf::Sound* sound;

CommandLineOptions options;

bool hasStarted        = true;
bool hasLost           = false;
bool jumpedToNextFrame = false;
bool isPaused          = false;

bool mouseLeftPressed   = false;
bool mouseLeftReleased  = false;
bool mouseRightPressed  = false;
bool mouseRightReleased = false;


// Modify if you want the music to start further on in the track. Measured in seconds.
const float debug_startTime = 0;
double totalElapsedTime = debug_startTime;
double gameElapsedTime = debug_startTime;

double mouseSensitivity = 1.0;
double lastMouseX = windowWidth / 2;
double lastMouseY = windowHeight / 2;


// Constants defining boids behavior

const float ALIGNMENT_RADIUS       = 0.7f;
const float COHESION_RADIUS        = 0.8f;
const float SEPARATION_RADIUS      = 0.5f;
const float PREDATOR_FEAR_RADIUS   = 0.5f;
const float SEARCH_RADIUS          = 0.8f;

// Weights for boid behaviors
const float PREDATOR_CHASE_WEIGHT  = 1.0f;
const float ALIGNMENT_WEIGHT  = 0.4f;
const float COHESION_WEIGHT   = 0.4f;
const float SEPARATION_WEIGHT = 1.0f;
const float FEAR_WEIGHT       = 4.0f;



#include <fstream>
#include <sstream>
#include <string>

std::string loadShaderSource(const std::string& filePath) {
    std::ifstream file(filePath);
    
    if (!file.is_open()) {
        std::cerr << "Failed to open shader file: " << filePath << std::endl;
        return "";
    }

    std::stringstream buffer;
    buffer << file.rdbuf(); // Read file contents into the stringstream
    return buffer.str();    // Return as a string
}


void mouseCallback(GLFWwindow* window, double x, double y) {
    int windowWidth, windowHeight;
    glfwGetWindowSize(window, &windowWidth, &windowHeight);
    glViewport(0, 0, windowWidth, windowHeight);

    double deltaX = x - lastMouseX;
    double deltaY = y - lastMouseY;

    glfwSetCursorPos(window, windowWidth / 2, windowHeight / 2);
}


SceneNode* rootNode;

void initGame(GLFWwindow* window, CommandLineOptions gameOptions) {
    buffer = new sf::SoundBuffer();
    if (!buffer->loadFromFile("../../res/Hall of the Mountain King.ogg")) {
        return;
    }

    options = gameOptions;

    for (int i = 0; i < NUM_BOIDS; ++i) {
        float x = static_cast<float>(rand()) / RAND_MAX * 2.0f - 1.0f;
        float y = static_cast<float>(rand()) / RAND_MAX * 2.0f - 1.0f;
        float z = static_cast<float>(rand()) / RAND_MAX * 2.0f - 1.0f;
        boids[i].position = glm::vec3(x * 4.f, y * 2.f, z * 2.f);

        // Random velocity
        float vx = static_cast<float>(rand()) / RAND_MAX * 2.0f - 1.0f;
        float vy = static_cast<float>(rand()) / RAND_MAX * 2.0f - 1.0f;
        float vz = static_cast<float>(rand()) / RAND_MAX * 2.0f - 1.0f;
        boids[i].velocity = glm::normalize(glm::vec3(vx, vy, vz)) * 1.2f;
    }


    glfwSetInputMode(window, GLFW_CURSOR, GLFW_CURSOR_HIDDEN);
    glfwSetCursorPosCallback(window, mouseCallback);

    shader = new Gloom::Shader();
    shader->makeBasicShader("../../res/shaders/simple.vert", "../../res/shaders/simple.frag");
    shader->activate();
    GLuint shaderProgram = shader->get();
    u_time       = glGetUniformLocation(shaderProgram, "iTime");
    u_resolution = glGetUniformLocation(shaderProgram, "iResolution");
    //posLoc       = glGetUniformLocation(shaderProgram, "boidPositions");
    //velLoc       = glGetUniformLocation(shaderProgram, "boidVelocities");
    //u_texture    = glGetUniformLocation(shaderProgram, "iChannel0");

    // mak eshader_compute .comp shader

    GLuint computeShader = glCreateShader(GL_COMPUTE_SHADER);
    std::string computeCode = loadShaderSource("../../res/shaders/boids.comp");
    const char* codePtr = computeCode.c_str();
    glShaderSource(computeShader, 1, &codePtr, nullptr);
    glCompileShader(computeShader);

    // Check for compile errors
    GLint success;
    glGetShaderiv(computeShader, GL_COMPILE_STATUS, &success);
    if (!success) {
        char infoLog[512];
        glGetShaderInfoLog(computeShader, 512, nullptr, infoLog);
        std::cerr << "ERROR: Compute shader compilation failed:\n" << infoLog << std::endl;
    }

    computeProgram = glCreateProgram();
    glAttachShader(computeProgram, computeShader);
    glLinkProgram(computeProgram);

    std::vector<GPUBoid> gpuBoids(NUM_BOIDS);


    for (int i = 0; i < NUM_BOIDS; ++i) {
        gpuBoids[i].position = glm::vec3(boids[i].position);
        gpuBoids[i].velocity = glm::vec3(boids[i].velocity);
    }

    glGenBuffers(1, &ssbo);
    glBindBuffer(GL_SHADER_STORAGE_BUFFER, ssbo);
    glBufferData(GL_SHADER_STORAGE_BUFFER, sizeof(GPUBoid) * NUM_BOIDS, gpuBoids.data(), GL_DYNAMIC_DRAW);
    glBindBufferBase(GL_SHADER_STORAGE_BUFFER, 0, ssbo);

    glGenBuffers(1, &ssboPosition);
    glBindBuffer(GL_SHADER_STORAGE_BUFFER, ssboPosition);
    glBufferData(GL_SHADER_STORAGE_BUFFER, sizeof(glm::vec3) * NUM_BOIDS, nullptr, GL_DYNAMIC_DRAW); // or with data if ready

    glGenBuffers(1, &ssboVelocity);
    glBindBuffer(GL_SHADER_STORAGE_BUFFER, ssboVelocity);
    glBufferData(GL_SHADER_STORAGE_BUFFER, sizeof(glm::vec3) * NUM_BOIDS, nullptr, GL_DYNAMIC_DRAW);


    unsigned int emptyVAO;
	glGenVertexArrays(1, &emptyVAO);
	glBindVertexArray(emptyVAO);

    getTimeDeltaSeconds();

    std::cout << "Ready. Click to start!" << std::endl;

    glm::vec2 resolution = glm::vec2(windowWidth, windowHeight); 
    //glUniform2fv(1,1, glm::value_ptr(resolution));
 
    
    rootNode = createSceneNode();
}


void renderNode(SceneNode* node) {
	switch (node->nodeType) {
	case POINT_LIGHT:
	{

	}
	break;
	}

	for (SceneNode* child : node->children) {
		renderNode(child);
	}
}

void updateFrame(GLFWwindow* window) {
    glfwSetInputMode(window, GLFW_CURSOR, GLFW_CURSOR_DISABLED);

 
    // Give the fragment shader at taste of time
    //glUniform1f(2, (float) totalElapsedTime);
    glUseProgram(shader->get()); // Just in case
    glUniform1f(u_time, static_cast<float>(totalElapsedTime));

    if (glfwGetMouseButton(window, GLFW_MOUSE_BUTTON_1)) {
        mouseLeftPressed = true;
        mouseLeftReleased = false;
    } else {
        mouseLeftReleased = mouseLeftPressed;
        mouseLeftPressed = false;
    }
    if (glfwGetMouseButton(window, GLFW_MOUSE_BUTTON_2)) {
        mouseRightPressed = true;
        mouseRightReleased = false;
    } else {
        mouseRightReleased = mouseRightPressed;
        mouseRightPressed = false;
    }

    double timeDelta = getTimeDeltaSeconds();

    // TODO call funtoin to calculate the new positions of the boids
    float timeStep = 0.005f;
    glm::vec3 bounds = glm::vec3(4.f, 2.f, 2.f);

    std::vector<glm::vec3> positions, velocities;
    for (const auto& b : boids) {
        positions.push_back(b.position);
        velocities.push_back(b.velocity);
    }


    if(!hasStarted) {
        if (mouseLeftPressed) {
            if (options.enableMusic) {
                sound = new sf::Sound();
                sound->setBuffer(*buffer);
                sf::Time startTime = sf::seconds(debug_startTime);
                sound->setPlayingOffset(startTime);
                sound->play();
            }
            totalElapsedTime = debug_startTime;
            gameElapsedTime = debug_startTime;
            hasStarted = true;
        }
        }
        else {
            totalElapsedTime += timeDelta;
            if(hasLost) {
                if (mouseLeftReleased) {
                    hasLost = false;
                    hasStarted = false;
                    currentKeyFrame = 0;
                    previousKeyFrame = 0;
                }
            } else if (isPaused) {
                if (mouseRightReleased) {
                    isPaused = false;
                    if (options.enableMusic) {
                        sound->play();
                    }
                }
            } else {
                gameElapsedTime += timeDelta;
                    if (mouseRightReleased) {
                        isPaused = true;
                        if (options.enableMusic) {
                            sound->pause();
                        }
                    }
                // Get the timing for the beat of the song
                for (unsigned int i = currentKeyFrame; i < keyFrameTimeStamps.size(); i++) {
                    if (gameElapsedTime < keyFrameTimeStamps.at(i)) {
                        continue;
                    }
                    currentKeyFrame = i;
                }

            jumpedToNextFrame = currentKeyFrame != previousKeyFrame;
            previousKeyFrame = currentKeyFrame;

            double frameStart = keyFrameTimeStamps.at(currentKeyFrame);
            double frameEnd = keyFrameTimeStamps.at(currentKeyFrame + 1); // Assumes last keyframe at infinity

            double elapsedTimeInFrame = gameElapsedTime - frameStart;
            double frameDuration = frameEnd - frameStart;
            double fractionFrameComplete = elapsedTimeInFrame / frameDuration;

            KeyFrameAction currentOrigin = keyFrameDirections.at(currentKeyFrame);
            KeyFrameAction currentDestination = keyFrameDirections.at(currentKeyFrame + 1);
        }
    }
    //glm::vec3 cameraPosition = glm::vec3(0.);
    glm::vec3 cameraPosition = glm::vec3(0, 2, -20);
    // TODO: maybe make camera move?

    //glUniform3fv(3,1, glm::value_ptr(cameraPosition));
}



void renderFrame(GLFWwindow* window) {
    int windowWidth, windowHeight;
    glfwGetWindowSize(window, &windowWidth, &windowHeight);
    glViewport(0, 0, windowWidth, windowHeight);

    // Dispatch the compute shader (updates `ssbo`)
    glUseProgram(computeProgram);
    glBindBufferBase(GL_SHADER_STORAGE_BUFFER, 0, ssbo); // SSBO with Boid structs
    glDispatchCompute(NUM_BOIDS, 1, 1);
    glMemoryBarrier(GL_SHADER_STORAGE_BARRIER_BIT); // ensure writes are visible

    // Insert this block RIGHT AFTER compute dispatch:
    {
        glBindBuffer(GL_SHADER_STORAGE_BUFFER, ssbo);
        GPUBoid* ptr = (GPUBoid*)glMapBuffer(GL_SHADER_STORAGE_BUFFER, GL_READ_ONLY);

        if (ptr) {
            std::vector<glm::vec3> posList, velList;
            for (int i = 0; i < NUM_BOIDS; ++i) {
                posList.push_back(ptr[i].position);
                velList.push_back(ptr[i].velocity);
            }

            glUnmapBuffer(GL_SHADER_STORAGE_BUFFER);

            // Upload to the separate buffers used in fragment shader
            glBindBuffer(GL_SHADER_STORAGE_BUFFER, ssboPosition);
            glBufferData(GL_SHADER_STORAGE_BUFFER, sizeof(glm::vec3) * NUM_BOIDS, posList.data(), GL_DYNAMIC_DRAW);

            glBindBuffer(GL_SHADER_STORAGE_BUFFER, ssboVelocity);
            glBufferData(GL_SHADER_STORAGE_BUFFER, sizeof(glm::vec3) * NUM_BOIDS, velList.data(), GL_DYNAMIC_DRAW);
        }
    }

    // Continue with rendering
    shader->activate();

    glUseProgram(shader->get());

    glUniform2f(u_resolution, static_cast<float>(windowWidth), static_cast<float>(windowHeight));

    // glBindBufferBase(GL_SHADER_STORAGE_BUFFER, 0, ssboPosition); // fragment shader reads these
    // glBindBufferBase(GL_SHADER_STORAGE_BUFFER, 1, ssboVelocity);
    glBindBuffer(GL_SHADER_STORAGE_BUFFER, ssbo);
    GPUBoid* ptr = (GPUBoid*)glMapBuffer(GL_SHADER_STORAGE_BUFFER, GL_READ_ONLY);

    renderNode(rootNode);

    glDrawArrays(GL_TRIANGLE_STRIP, 0, 4); // Fullscreen quad
}



