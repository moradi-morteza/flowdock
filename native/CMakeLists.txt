cmake_minimum_required(VERSION 3.24)
project(flowdock_native LANGUAGES CXX)

add_executable(flowdock-native src/main.cpp)
target_compile_features(flowdock-native PRIVATE cxx_std_20)
target_compile_definitions(flowdock-native PRIVATE UNICODE _UNICODE WIN32_LEAN_AND_MEAN NOMINMAX)
target_link_libraries(flowdock-native PRIVATE user32 dwmapi kernel32)

set_target_properties(flowdock-native PROPERTIES
  RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/bin"
  VS_DEBUGGER_WORKING_DIRECTORY "${CMAKE_SOURCE_DIR}"
)

if(MSVC)
  target_compile_options(flowdock-native PRIVATE /W4 /permissive- /EHsc /utf-8)
endif()
