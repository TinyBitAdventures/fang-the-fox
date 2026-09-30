# Fang the Fox, Game Boy Color edition.
#   make          generate from the web game's data, then build build/fang.gbc
#   make run      build, then copy the ROM where the web player (web/) loads it
#   make watch    rebuild and reload the web player whenever a source changes
#   make report   the per-area budget table
GBDK_HOME ?= $(HOME)/opt/gbdk
LCC       = $(GBDK_HOME)/bin/lcc
ROM       = build/fang.gbc
LCCFLAGS  = -Wm-yC -Wl-yt0x1B -Wm-ya4 -Wl-j -autobank -Wb-ext=.rel -Wm-yn"FANGTHEFOX" -Isrc -Ilib/hUGEDriver -Wf--max-allocs-per-node50000 -Wf--opt-code-speed
WEB       = ../js/data.js ../js/palette.js ../js/font.js $(wildcard ../js/sprites-*.js)

SRC       = $(wildcard src/*.c)
GEN_STAMP = build/gen.stamp
OBJDIR    = build/obj

.PHONY: all run watch report clean
all: $(ROM)

$(GEN_STAMP): tools/build.js $(wildcard tools/lib/*.js) overrides.js $(WEB) $(wildcard art/*.js) $(wildcard music/*.js) ../tools/validate.js
	@mkdir -p build
	node tools/build.js
	@touch $@

$(ROM): $(GEN_STAMP) $(SRC) $(wildcard src/*.h) Makefile
	@mkdir -p $(OBJDIR)
	@rm -f $(OBJDIR)/*.o $(OBJDIR)/*.rel
	@for f in $(SRC) src/gen/*.c; do \
	  $(LCC) $(LCCFLAGS) -c -o $(OBJDIR)/$$(basename $$f .c).o $$f || exit 1; \
	done
	$(LCC) $(LCCFLAGS) -Wl-llib/hUGEDriver/hUGEDriver.lib -o $(ROM) $(OBJDIR)/*.o
	@rm -f build/*.ihx build/*.cdb 2>/dev/null; true   # keeps fang.noi (symbols, for tests) and fang.map

run: $(ROM)
	@mkdir -p web/rom
	@cp $(ROM) web/rom/.fang.gbc.tmp && mv -f web/rom/.fang.gbc.tmp web/rom/fang.gbc
	@echo "web/rom/fang.gbc updated: https://fangthefox.localhost/gbc/"

watch:
	node tools/watch.js

report:
	node tools/build.js --report

clean:
	rm -rf build src/gen web/rom
