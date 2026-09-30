# Fang the Fox, Game Boy Color edition.
#   make          generate from the web game's data, then build build/fang.gbc
#   make run      build, then copy the ROM where the web player (web/) loads it
#   make watch    rebuild and reload the web player whenever a source changes
#   make report   the per-area budget table
GBDK_HOME ?= $(HOME)/opt/gbdk
LCC       = $(GBDK_HOME)/bin/lcc
ROM       = build/fang.gbc
LCCFLAGS  = -Wm-yC -Wl-yt0x1B -Wm-ya4 -Wl-j -autobank -Wb-ext=.rel -Wm-yn"FANGTHEFOX" -Isrc -Ilib/hUGEDriver -Wf--max-allocs-per-node50000 -Wf--opt-code-speed
WEB       = ../js/data.js ../js/story.js ../js/palette.js ../js/font.js $(wildcard ../js/sprites-*.js)

SRC       = $(wildcard src/*.c)
GEN_STAMP = build/gen.stamp
OBJDIR    = build/obj

.PHONY: all run watch report clean
all: $(ROM)

$(GEN_STAMP): tools/build.js $(wildcard tools/lib/*.js) overrides.js src/story.c $(WEB) $(wildcard art/*.js) $(wildcard music/*.js) ../tools/validate.js
	@mkdir -p build
	node tools/build.js
	@touch $@

# a source compiles again when it, a header or the Makefile is newer than its object (the generator
# only rewrites the files whose content changed); objects whose source went away are dropped
$(ROM): $(GEN_STAMP) $(SRC) $(wildcard src/*.h) Makefile
	@mkdir -p $(OBJDIR)
	@for f in $(SRC) src/gen/*.c; do \
	  o=$(OBJDIR)/$$(basename $$f .c).o; \
	  if [ ! -f $$o ] || [ $$f -nt $$o ] || [ -n "$$(find src/*.h src/gen/*.h src/gen/*.inc Makefile -newer $$o 2>/dev/null | head -1)" ]; then \
	    echo "  cc $$f"; $(LCC) $(LCCFLAGS) -c -o $$o $$f || { rm -f $$o; exit 1; }; \
	  fi; \
	done
	@for o in $(OBJDIR)/*.o; do n=$$(basename $$o .o); [ -f src/$$n.c ] || [ -f src/gen/$$n.c ] || rm -f $$o; done
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
