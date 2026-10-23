package com.lqwd.model;

import java.util.UUID;

public class Role {

    private int id;

    private UUID uuid_id;

    private String name;



    public Role() {
        super();
        // TODO Auto-generated constructor stub
    }

    public int getId() {
        return id;
    }

    public void setId(int id) {
        this.id = id;
    }

    public UUID getUuid_id() {
        return uuid_id;
    }

    public void setUuid_id(UUID uuid_id) {
        this.uuid_id = uuid_id;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }


}
