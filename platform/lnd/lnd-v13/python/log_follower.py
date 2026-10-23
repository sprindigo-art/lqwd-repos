import time


class LogFollower:
    def __init__(self, fp):
        self.position = 0
        self.fp = fp

    def seek(self):
        self.fp.seek(self.position)

    def has(self):
        self.seek()
        return '\n' in self.fp.read()

    def __iter__(self):
        while self.has():
            self.seek()
            line = self.fp.read().split('\n')[0]
            yield line

            # advance position - this is the 'state machine' part!
            self.position += len(line) + 1