package com.lqwd.model.enums;

import avro.shaded.com.google.common.collect.Sets;

import java.util.HashSet;
import java.util.Set;

public class LndNodeActionSet {

    public static Set<String> auditActionSet = Sets.newHashSet(
            "/v1/channel/open_channel",
            "/v1/channel/available",
            "/v1/sync_channels"
    );

    public static Set<String> supervisorActionSet = Sets.newHashSet(
            "/v1/channel/open_channel",
            "/v1/channel/available",
            "/v1/sync_channels"
    );

}
