# TDT4230 - Graphics and Visualization Final Project

The final project will be showcased [here](https://www.idi.ntnu.no/grupper/vis/teaching/)

## What do i do?

	git clone --recursive https://github.com/bartvbl/TDT4230-Assignment-1.git

Should you forget the `--recursive` bit, just run:

	git submodule update --init


### Windows

Install Microsoft Visual Studio Express and CMake.
You may use CMake-gui or the command-line cmake to generate a Visual Studio solution.


### Build
```bash
cd TDT4230-Assignment-1
cmake --build build
```

### Run

```bash
cd TDT4230-Assignment-1/build/Debug
glowbox.exe

```


### Linux:

Make sure you have a C/C++ compiler such as  GCC, CMake and Git.

	make run

which is equivalent to

	git submodule update --init
	cd build
	cmake ..
	make
	./glowbox
