CC = cc
CFLAGS = -Wall -Wextra -O2 -std=c11
LDFLAGS = -lcurl
TARGET = google-health-mcp

SRCS = main.c auth.c cJSON.c
OBJS = $(SRCS:.c=.o)

all: $(TARGET)

$(TARGET): $(OBJS)
	$(CC) $(CFLAGS) -o $@ $(OBJS) $(LDFLAGS)

%.o: %.c
	$(CC) $(CFLAGS) -c -o $@ $<

clean:
	rm -f $(OBJS) $(TARGET)

# Minimal binary (strip + size-optimize)
small: CFLAGS = -Wall -Os -std=c11 -DNDEBUG
small: LDFLAGS = -lcurl -Wl,-dead_strip
small: clean $(TARGET)
	strip $(TARGET)

.PHONY: all clean small
