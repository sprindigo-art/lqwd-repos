package com.lqwd.security.oauth2.service;

import com.lqwd.security.oauth2.dto.RoleDTO;
import com.lqwd.security.oauth2.model.security.Mservice;
import com.lqwd.security.oauth2.model.security.Role_;
import com.lqwd.security.oauth2.repository.MserviceRepository;
import com.lqwd.security.oauth2.repository.RoleRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import javax.validation.constraints.Null;
import java.util.*;

@Service
public class RoleService {

    @Autowired
    RoleRepository roleRepository;

    @Autowired
    MserviceRepository mserviceRepository;
    

    @Transactional(readOnly = true)
    public Role_ findByName(String name){

        Optional<Role_> role = roleRepository.findByName(name);
        if(role.isPresent()){
            return role.get();
        }

        throw new UsernameNotFoundException(name);
    }

    @Transactional(readOnly = true)
    public Role_ findByMservice(UUID mservice_id){

        Optional<Role_> role = roleRepository.findByMserviceId(mservice_id);
        if(role.isPresent()){
            return role.get();
        }

        throw new UsernameNotFoundException(mservice_id.toString());
    }

//    @Transactional(readOnly = true)
    public Collection<Role_> findAllByMservice(String mserviceName){
        Optional<Mservice> mservice = mserviceRepository.findByName(mserviceName);
        if(mservice.isPresent()){
            Collection<Role_> roleCollection = roleRepository.findNonDeletedByMservice(mservice.get().getId());
            return roleCollection;
        }
        return new ArrayList<Role_>();
    }

    public Role_ findAllByMserviceAndRole(String mserviceName, String roleName){
        Optional<Mservice> mservice = mserviceRepository.findByName(mserviceName);
        if(mservice.isPresent()){
            Optional<Role_> role_ = roleRepository.findNonDeletedByMserviceAndRole(mservice.get().getId(), roleName );
            if(role_.isPresent()) {
                return role_.get();
            }
        }
        return null;
    }


    public Page<Role_> getAllNonDeleted(int currentPage, int amount) {
        Pageable pageable = PageRequest.of(currentPage, amount);
        return roleRepository.findAllNonDeleted(pageable);
    }

    public List<Role_> listAllNonDeleted() {

        return roleRepository.listAllNonDeleted();
    }

    public List<String> listByUser(UUID id) {
        return roleRepository.getUserRoles(id);
    }

    public Role_ findRole(String id) {
        Optional<Role_> role_ = roleRepository.findById(java.util.UUID.fromString(id));
        if(role_.isPresent()){
            return role_.get();
        }
        return null;
    }
    
    
    public RoleDTO getRoleDTO(String id) {
    	return toDTO(findRole(id));
    }
    
    public Role_ saveRole_FromDTO(RoleDTO roleDTO) {

        String roleLabel = roleDTO.getName().toUpperCase();

        int roleLabelCount = roleRepository.checkRoleExist(roleLabel);
        if(roleLabelCount == 0){
            roleRepository.addRoleLabel(roleLabel);
        }

    	Role_ role = new Role_();
    	if(roleDTO.getId() != null && roleDTO.getId().trim().length() > 0) {
    		role = roleRepository.findById(java.util.UUID.fromString(roleDTO.getId())).get();
    	}
    	role = toModel(roleDTO, role);
    	Mservice mservice = mserviceRepository.findById(java.util.UUID.fromString(roleDTO.getMserviceId())).get();
    	role.setMservice(mservice);
    	role = saveRole(role);
        return role;
    }
    
    
    public Role_ saveRole(Role_ role) {
        return roleRepository.save(role);
    }
    
    private RoleDTO toDTO(Role_ role) {
    	if ( role == null ) {
            return null;
        }

        RoleDTO roleDTO = new RoleDTO();

        roleDTO.setName( role.getName() );
        roleDTO.setStatus( role.getStatus() );

        roleDTO.setId( role.getId().toString() );
        roleDTO.setMserviceId( role.getMservice().getId().toString() );

        return roleDTO;
    }
    
    private Role_ toModel(RoleDTO roleDTO, Role_ role) {
    	if ( roleDTO == null ) {
            return null;
        }

        role.setName( roleDTO.getName().toUpperCase() );
        role.setStatus( roleDTO.getStatus() );

        return role;
    }

    public List<String> getRoleLabels(){
        return roleRepository.getRoleLabels();
    }
    
}
