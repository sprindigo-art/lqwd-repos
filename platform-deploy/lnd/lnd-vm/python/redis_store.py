import redis
import os


class RedisStore:

    def __init__(self, cred):
        self.redis = redis.Redis(host=os.getenv("REDIS_HOST"), port=os.getenv("REDIS_PORT"),
                                 password=cred)

    def get(self, key):
        return self.redis.get(key)

    def set_with_expiry(self, key, value, expiry_time):
        self.redis.setex(key, expiry_time, value)
