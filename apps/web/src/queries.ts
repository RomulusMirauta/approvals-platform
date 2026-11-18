import type { CreateRequestBody, DecisionBody, ListRequestsQuery, RequestDetail } from '@approvals/contracts';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

export const useMe = () => useQuery({ queryKey: ['me'], queryFn: api.me });

export const useStats = () => useQuery({ queryKey: ['stats'], queryFn: api.stats });

export const useTags = () => useQuery({ queryKey: ['tags'], queryFn: api.tags });

export const useRequests = (query: ListRequestsQuery) =>
  useQuery({
    queryKey: ['requests', query],
    queryFn: () => api.listRequests(query),
    // Keep showing the current page while the next one loads, so the list doesn't jump.
    placeholderData: keepPreviousData,
  });

export const useRequest = (id: string) => useQuery({ queryKey: ['request', id], queryFn: () => api.getRequest(id) });

// A change to one request can move it between lists and change the counts, so the lists and stats
// are refetched while the detail is updated straight from the response.
function useRequestChanged() {
  const queryClient = useQueryClient();
  return (request: RequestDetail) => {
    queryClient.setQueryData(['request', request.id], request);
    void queryClient.invalidateQueries({ queryKey: ['requests'] });
    void queryClient.invalidateQueries({ queryKey: ['stats'] });
    void queryClient.invalidateQueries({ queryKey: ['tags'] });
  };
}

export function useDecide(id: string) {
  const onChanged = useRequestChanged();
  return useMutation({ mutationFn: (body: DecisionBody) => api.decide(id, body), onSuccess: onChanged });
}

export function useCancel(id: string) {
  const onChanged = useRequestChanged();
  return useMutation({ mutationFn: () => api.cancel(id), onSuccess: onChanged });
}

export function useCreateRequest() {
  const onChanged = useRequestChanged();
  return useMutation({
    mutationFn: (body: CreateRequestBody) => api.createRequest(body),
    onSuccess: (response) => onChanged(response.request),
  });
}

export function useAddComment(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: string) => api.addComment(id, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['request', id] }),
  });
}
